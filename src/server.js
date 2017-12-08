const moment = require('moment');
const express = require('express');
const { writeFileSync } = require('fs');
const config = require('./config.json');
const { name, version } = require('../package.json');

const server = express();
const http = require('http').Server(server);
const uws = require('uws');

http.listen(config.port, () => {
	console.log(`[${events.timestamp}] ${name} v${version} running on port ${config.port}!${config.SSLproxy ? ' (Proxied to SSL)' : ''}`);
});

const channels = {};
const users = {};
const sockets = {};
let socketID = 0;
// to look up which user belongs to which socket

server.get('/', (req, res) => res.send(`Chatron server listening on port ${config.port}.`));

const socketServer = new uws.Server({ server: http });

socketServer.on('connection', socket => {
	socket.pingInterval = setInterval(() => socket.ping(), 1000 * 45);
	socket.id = ++socketID;
	sockets[socket.id] = socket;

	socket.on('message', message => {
		const data = JSON.parse(message);

		if (data.type === 'login') events.login(data.user, socket);
		if (data.type === 'channelJoin') events.channelJoin(data.user, data.userChannels, socket);
		if (data.type === 'channelLeave') events.channelLeave(data.user, data.userChannels, socket);
		if (data.type === 'userMessage') events.userMessage(data.message, socket);
		if (data.type === 'logout') events.deleteUser(data.user, socket);
	});

	socket.on('close', () => {
		let user;

		Object.values(users).forEach(u => {
			if (u.id === socket.id) return user = u;
		});

		if (user) events.deleteUser(user, socket);
	});
});

const events = {
	get timestamp() {
		return moment().format('DD/MM/YYYY HH:mm:ss');
	},

	login(user, socket) {
		const loginData = { channels: {} };
		user.id = sockets[socket.id].id;

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

			const systemMessage = {
				content: `<b>${user.username}</b> has joined.`,
				author: { username: 'system' },
				timestamp: Date.now(), // unix timestamp to account for timezones
				channel: { name: channel.name }
			};

			Object.values(users).forEach(chatronUser => {
				if (Object.keys(users).length === 0) return;

				if (chatronUser.channels.hasOwnProperty(channel.name)) {
					sockets[chatronUser.id].send(JSON.stringify({ type: 'userMessage', userMessage: systemMessage }));
				}
			});
			channels[channel.name].messages.push(systemMessage);

			Object.values(users).forEach(chatronUser => {
				if (Object.keys(users).length === 0) return;

				if (chatronUser.channels.hasOwnProperty(channel.name)) {
					sockets[chatronUser.id].send(JSON.stringify({
						type: 'channelUserEnter',
						user: { username: user.username },
						channel: { name: channel.name }
					}));
				}
			});
		});

		if (!loginData.error) {
			const channelNames = Object.keys(user.channels);

			for (const channelName of channelNames) {
				loginData.channels[channelName] = channels[channelName];
			}

			users[user.username] = user;

			console.log(`[${events.timestamp}] User '${user.username}' connected and joined the '${channelNames.join('\', \'')}' channel(s).`);
		}

		return socket.send(JSON.stringify({ type: 'login', loginData }));
	},

	channelJoin(user, userChannels, socket) {
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

				const systemMessage = {
					content: `<b>${user.username}</b> has joined.`,
					author: { username: 'system' },
					timestamp: Date.now(), // unix timestamp to account for timezones
					channel: { name: channel.name }
				};

				Object.values(users).forEach(chatronUser => {
					if (Object.keys(users).length === 0) return;

					if (chatronUser.channels.hasOwnProperty(channel.name)) {
						sockets[chatronUser.id].send(JSON.stringify({ type: 'userMessage', userMessage: systemMessage }));
					}
				});
				channels[channel.name].messages.push(systemMessage);

				Object.values(users).forEach(chatronUser => {
					if (Object.keys(users).length === 0) return;

					if (chatronUser.channels.hasOwnProperty(channel.name)) {
						sockets[chatronUser.id].send(JSON.stringify({
							type: 'channelUserEnter',
							user: { username: user.username },
							channel: { name: channel.name }
						}));
					}
				});
			}
		});

		if (!channelData.error) {
			console.log(`[${events.timestamp}] User '${user.username}' joined the '${userChannels.map(c => c.name).join(', ')}' channel(s).`);
		}

		socket.send(JSON.stringify({ type: 'channelJoin', channelData }));
	},

	channelLeave(user, userChannels, socket) {
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
				channelData.channels.push(channels[channel.name] || { name: channel.name, users: { [user.username]: user }, messages: [] });
				// either the channel itself or an empty one if it was just deleted

				const systemMessage = {
					content: `<b>${user.username}</b> has left.`,
					author: { username: 'system' },
					timestamp: Date.now(), // unix timestamp to account for timezones
					channel: { name: channel.name }
				};

				Object.values(users).forEach(chatronUser => {
					if (Object.keys(users).length === 0) return;

					if (chatronUser.channels.hasOwnProperty(channel.name)) {
						sockets[chatronUser.id].send(JSON.stringify({ type: 'userMessage', userMessage: systemMessage }));
					}
				});
				channels[channel.name].messages.push(systemMessage);

				Object.keys(channels[channel.name].users).length - 1
					? delete channels[channel.name].users[user.username]
					: delete channels[channel.name];
				// delete channel if removing this user would empty it completely

				Object.values(users).forEach(chatronUser => {
					if (Object.keys(users).length === 0) return;

					if (chatronUser.channels.hasOwnProperty(channel.name)) {
						sockets[chatronUser.id].send(JSON.stringify({
							type: 'channelUserLeave',
							user: { username: user.username },
							channel: { name: channel.name }
						}));
					}
				});
			}
		});

		if (!channelData.error) {
			console.log(`[${events.timestamp}] User '${user.username}' left the '${userChannels.map(c => c.name).join(', ')}' channel(s).`);
		}
		socket.send(JSON.stringify({ type: 'channelLeave', channelData }));
	},

	userMessage(message, socket) {
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

		return Object.values(users).forEach(chatronUser => {
			if (Object.keys(users).length === 0) return;

			if (chatronUser.channels.hasOwnProperty(message.channel.name)) {
				sockets[chatronUser.id].send(JSON.stringify({ type: 'userMessage', userMessage: messageData }));
			}
		});
	},

	deleteUser(user, socket) {
		delete users[user.username];
		delete sockets[socket.id];

		Object.values(user.channels).forEach(channel => {
			const systemMessage = {
				content: `<b>${user.username}</b> has left.`,
				author: { username: 'system' },
				timestamp: Date.now(), // unix timestamp to account for timezones
				channel: { name: channel.name }
			};

			Object.values(users).forEach(chatronUser => {
				if (Object.keys(users).length === 0) return;

				if (chatronUser.channels.hasOwnProperty(channel.name)) {
					sockets[chatronUser.id].send(JSON.stringify({ type: 'userMessage', userMessage: systemMessage }));
				}
			});
			channels[channel.name].messages.push(systemMessage);

			Object.keys(channels[channel.name].users).length - 1
				? delete channels[channel.name].users[user.username]
				: delete channels[channel.name];
			// delete channel if removing this user would empty it completely

			Object.values(users).forEach(chatronUser => {
				if (Object.keys(users).length === 0) return;

				if (chatronUser.channels.hasOwnProperty(channel.name)) {
					sockets[chatronUser.id].send(JSON.stringify({
						type: 'channelUserLeave',
						user: { username: user.username },
						channel: { name: channel.name }
					}));
				}
			});
		});

		console.log(`[${events.timestamp}] User '${user.username}' disconnected and left all channels.`);
		return socket.send(JSON.stringify({ type: 'logout' }));
	}
};