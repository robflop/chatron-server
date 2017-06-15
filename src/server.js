const moment = require('moment');
const express = require('express');
const { writeFileSync } = require('fs');
const config = require('./config.json');

const server = express();
const http = require('http').Server(server);
const io = require('socket.io')(http);

const timestamp = moment().format('DD/MM/YYYY HH:mm:ss');

http.listen(config.port, () => {
	console.log(`[${timestamp}] chatron server running on port ${config.port}!${config.SSLproxy ? ' (Proxied to SSL)' : ''}`);
}); // info for self: listening using http because socket.io doesn't take an express instance (see socket.io docs)

const channels = {};
const users = [];

server.get('/', (req, res) => res.send('Ay, chatron server.'));

io.on('connection', socket => {
	socket.on('login', user => {
		if (users.includes(user.username)) {
			return socket.emit('duplicateUsernameError', { message: 'Username is taken.' });
		}
		if (user.username.length > 32 || user.username.length < 2) {
			return socket.emit('usernameLengthError', { message: 'Username must be between 2 and 32 characters long.' });
		}

		Object.values(user.channels).forEach(channel => {
			if (channel.name.length > 32 || channel.name.length < 2) {
				return socket.emit('channelNameLengthError', {
					message: 'Channel names must be between 2 and 32 characters long.',
					channel: channel.name
				});
			}

			channels.hasOwnProperty(channel.name)
			? channels[channel.name].users.push(user.username)
			: channels[channel.name] = { name: channel.name, users: [user.username] };

			return socket.to(channel.name).emit('systemMessage', {
				content: `User ${user.username} has joined.`,
				timestamp: moment().format('YYYY-MM-DD')
			});
		});

		const channelNames = Object.keys(user.channels);
		users.push(user.username);
		socket.join(channelNames);

		console.log(`User ${user.username} connected and joined the '${channelNames.join('\', \'')}' channel(s).`);
		socket.emit('channelData', channels);
		return socket.emit('loginSuccess', null);
	});

	socket.on('logout', user => {
		users.splice(users.indexOf(user.username), 1);
		Object.values(user.channels).forEach(channel => {
			const index = channels[channel.name].users.indexOf(user.username);
			channels[channel.name].users.splice(index, 1);

			return socket.to(channel.name).emit('systemMessage', {
				content: `User ${user.username} has left.`,
				timestamp: moment().format('YYYY-MM-DD')
			});
		});

		console.log(`User ${user.username} disconnected and left all channels.`);
		socket.emit('logoutSuccess', null);
	});

	socket.on('messageSend', message => {
		/*
		update stuff before this
		message properties: channel, author, content, timestamp
		*/
		socket.to(message.channel).emit('message', {
			// emit updated stuff
		});
	});

	socket.on('channelJoin', (user, channel) => {
		if (Object.keys(user.channels).includes(channel.name)) {
			return socket.emit('duplicateChannelError', {
				message: 'User is already in requested channel.',
				channel: channel.name
			});
		}
		if (channel.name.length > 32 || channel.name.length < 2) {
			return socket.emit('channelNameLengthError', {
				message: 'Channel names must be between 2 and 32 characters long.',
				channel: channel.name
			});
		}

		channels.hasOwnProperty(channel.name)
		? channels[channel.name].users.push(user.username)
		: channels[channel.name] = { name: channel.name, users: [user.username] };

		socket.join([channel.name]);
		socket.to(channel.name).emit('systemMessage', {
			content: `User ${user.username} has joined.`,
			timestamp: moment().format('YYYY-MM-DD')
		});

		console.log(`User ${user.username} joined the '${channel}' channel.`);
		socket.emit('channelJoinSuccess', (user, channel));
	});

	socket.on('channelLeave', (user, channel) => {
		if (!Object.keys(user.channels).includes(channel.name)) {
			return socket.emit('missingChannelError', {
				message: 'User is not in requested channel.',
				channel: channel.name
			});
		}

		const index = channels[channel.name].users.indexOf(user.username) || -1;

		channels[channel.name].users.length - 1
		? channels[channel.name].users.splice(index, 1)
		: delete channels[channel.name];
		// delete channel if removing this user would empty it completely

		socket.to(channel.name).emit('systemMessage', {
			content: `User ${user.username} has left.`,
			timestamp: moment().format('YYYY-MM-DD')
		});

		socket.leave(channel.name);
		console.log(`User ${user.username} left the '${channel.name}' channel.`);
		socket.emit('channelLeaveSuccess', (user, channel));
	});
});