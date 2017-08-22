const moment = require('moment');
const express = require('express');
const { writeFileSync } = require('fs');
const config = require('./config.json');
const { name, version } = require('../package.json');

const server = express();
const http = require('http').Server(server);
const io = require('socket.io')(http);

const timestamp = moment().format('DD/MM/YYYY HH:mm:ss');

http.listen(config.port, () => {
	console.log(`[${timestamp}] ${name} v${version} running on port ${config.port}!${config.SSLproxy ? ' (Proxied to SSL)' : ''}`);
}); // info for self: listening using http because socket.io doesn't take an express instance (see socket.io docs)

const channels = {};
const users = {};

server.get('/', (req, res) => res.send(`Chatron server listening on port ${config.port}.`));

io.on('connection', socket => {
	socket.on('login', user => {
		const loginData = { channels: {} };
		if (users.hasOwnProperty(user.username) || user.username.toLowerCase() === 'system') {
			loginData.error = { type: 'duplicateUsernameError', message: 'Username is taken.' };
		}
		if (user.username.length < 2 || user.username.length > 32) {
			loginData.error = { type: 'usernameLengthError', message: 'Username must be between 2 and 32 characters long.' };
		}

		Object.values(user.channels).forEach(channel => {
			if (loginData.error) return;

			if (channel.name.length < 2 || channel.name.length > 32) {
				return loginData.error = {
					type: 'channelNameLengthError',
					message: 'Channel names must be between 2 and 32 characters long.',
					channel: channel.name
				};
			}

			channels.hasOwnProperty(channel.name)
				? channels[channel.name].users[user.username] = user
				: channels[channel.name] = { name: channel.name, users: { [user.username]: user }, messages: [] };

			return socket.to(channel.name).emit('channelUserEnter', { username: user.username }, { name: channel.name });
		});

		if (!loginData.error) {
			const channelNames = Object.keys(user.channels);

			for (const channelName of channelNames) {
				loginData.channels[channelName] = channels[channelName];
			}

			users[user.username] = user;
			socket.join(channelNames);

			console.log(`User '${user.username}' connected and joined the '${channelNames.join('\', \'')}' channel(s).`);
		}

		return socket.emit('login', loginData);
	});

	socket.on('channelJoin', (user, userChannels) => {
		const channelData = { channels: [] };

		userChannels.forEach(channel => {
			if (Object.keys(user.channels).includes(channel.name)) {
				channelData.error = {
					type: 'duplicateChannelError',
					message: 'User is already in requested channel.',
					channel: channel.name
				};
			}
			if (channel.name.length < 2 || channel.name.length > 32) {
				channelData.error = {
					type: 'channelNameLengthError',
					message: 'Channel names must be between 2 and 32 characters long.',
					channel: channel.name
				};
			}

			if (!channelData.error) {
				channels.hasOwnProperty(channel.name)
					? channels[channel.name].users[user.username] = user
					: channels[channel.name] = { name: channel.name, users: { [user.username]: user }, messages: [] };

				channelData.channels.push(channels[channel.name]);

				socket.join([channel.name]);
				socket.to(channel.name).emit('channelUserEnter', { username: user.username }, { name: channel.name });
			}
		});

		console.log(`User '${user.username}' joined the '${userChannels.map(c => c.name).join(', ')}' channel(s).`);
		socket.emit('channelJoin', channelData);
	});

	socket.on('channelLeave', (user, userChannels) => {
		const channelData = { channels: [] };

		userChannels.forEach(channel => {
			if (!Object.keys(user.channels).includes(channel.name)) {
				channelData.error = {
					type: 'missingChannelError',
					message: 'User is not in requested channel.',
					channel: channel.name
				};
			}

			if (!channelData.error) {
				Object.keys(channels[channel.name].users).length - 1
					? delete channels[channel.name].users[user.username]
					: delete channels[channel.name];
				// delete channel if removing this user would empty it completely

				channelData.channels.push(channels[channel.name] || { name: channel.name, users: { [user.username]: user }, messages: [] });
				// either the channel itself or an empty one if it was just deleted

				socket.to(channel.name).emit('channelUserLeave', { username: user.username }, { name: channel.name });
				socket.leave(channel.name);
			}
		});

		console.log(`User '${user.username}' left the '${userChannels.map(c => c.name).join(', ')}' channel(s).`);
		socket.emit('channelLeave', channelData);
	});

	socket.on('message', message => {
		const messageData = {};

		if (message.content.length === 0) {
			messageData.error = {
				type: 'emptyMessageError',
				message: 'Messages may not be empty.',
				channel: message.channel.name
			};
		}

		if (message.content.length > 2000) {
			messageData.error = {
				type: 'maxCharLimitError',
				message: 'Messages may not be longer than 2000 characters.',
				channel: message.channel.name
			};
		}

		if (!messageData.error) {
			channels[message.channel.name].messages.push(message);
			Object.assign(messageData, message);
		}

		// return socket.to(message.channel.name).emit('message', message);
		// only sending to room doesn't seem to work? ^
		return io.sockets.emit('message', messageData);
	});

	socket.on('logout', user => {
		delete users[user.username];
		Object.values(user.channels).forEach(channel => {
			Object.keys(channels[channel.name].users).length - 1
				? delete channels[channel.name].users[user.username]
				: delete channels[channel.name];
			// delete channel if removing this user would empty it completely

			return socket.to(channel.name).emit('channelUserLeave', { username: user.username }, { name: channel.name });
		});

		console.log(`User '${user.username}' disconnected and left all channels.`);
		socket.emit('logout', null);
	});
});