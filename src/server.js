const config = require('./config.json');
const moment = require('moment');
const express = require('express');
const { writeFileSync } = require('fs');

const knex = require('knex')({
	client: 'sqlite3',
	useNullAsDefault: true,
	connection: {
		filename: config.databasePath
	}
});

const server = express();
const http = require('http').Server(server);
const io = require('socket.io')(http);

const timestamp = moment().format('DD/MM/YYYY HH:mm:ss');

http.listen(config.port, () => {
	console.log(`[${timestamp}] chatron server running on port ${config.port}!${config.SSLproxy ? ' (Proxied to SSL)' : ''}`);
}); // info for self: listening using http because socket.io doesn't take an express instance (see socket.io docs)

if (config.firstRun) {
	// prepare the database on first run
	knex.schema.createTableIfNotExists('channels', table => {
		table.increments();
		table.string('name').unique();
		table.string('topic');
	}).then(() => {
		knex('channels').insert({ name: 'general', topic: 'The beginning of it all.' })
		.then(() => null);
	});

	config.firstRun = false;
	writeFileSync(`./config.json`, JSON.stringify(config, null, '\t'));
}

const channels = new Map();
const usernames = [];

knex.select('*').from('channels').then(rows => {
	rows.map(channel => channels.set(channel.id, channel));
	// console.log(channels.get(1));
});

server.get('/', (req, res) => res.send('Ay, chatron server.'));

io.on('connection', socket => {
	socket.on('login', user => {
		if (usernames.includes(user.username)) {
			return socket.emit('duplicateUsernameError', { message: 'Username is taken.' });
		}
		if (user.username.length > 32 || user.username.length < 2) {
			return socket.emit('usernameLengthError', { message: 'Username must be between 2 and 32 characters long.' });
		}
		user.channels.map(channel => {
			if (channel.length > 32 || channel.length < 2) {
				return socket.emit('channelLengthError', { message: `Channel names must be between 2 and 32 characters long. ('${channel}')` });
			}
			return null;
		});
		user.channels.map(channel => { // eslint-disable-line arrow-body-style
			return socket.to(channel).emit('systemMessage', {
				content: `User ${user.username} has joined.`,
				timestamp: moment().format('YYYY-MM-DD')
			});
		});
		usernames.push(user.username);
		socket.join(user.channels);
		console.log(`User ${user.username} connected and joined the '${user.channels.join('\', \'')}' channel(s).`);
		socket.emit('loginSuccess', null);
	});

	socket.on('logout', user => {
		console.log(`User ${user.username} disconnected and left all channels.`);
		user.channels.map(channel => { // eslint-disable-line arrow-body-style
			return socket.to(channel).emit('systemMessage', { content: `User ${user.username} has left.`, timestamp: moment().format('YYYY-MM-DD') });
		});
		usernames.splice(usernames.indexOf(user.username), 1);
		socket.emit('logoutSuccess', null);
	});

	socket.on('message', message => {
		/*
		update stuff before this
		message properties: channel, author, content, timestamp
		*/
		socket.to(message.channel).emit('update', {
			// emit updated stuff
		});
	});

	socket.on('channelJoin', data => {
		const user = data.user, channel = data.channel;
		if (user.channels.includes(channel)) return socket.emit('duplicateChannelError', { message: 'User is already in requested channel.' });
		if (channel.length > 32 || channel.length < 2) {
			return socket.emit('channelLengthError', { message: `Channel names must be between 2 and 32 characters long. ('${channel}')` });
		}
		console.log(`User ${user.username} joined the '${channel}' channel.`);
		socket.join([channel]);
		socket.to(channel).emit('systemMessage', { content: `User ${user.username} has joined.`, timestamp: moment().format('YYYY-MM-DD') });
		socket.emit('channelJoinSuccess', (user, channel));
	});

	socket.on('channelLeave', data => {
		const user = data.user, channel = data.channel;
		if (!user.channels.includes(channel)) return socket.emit('missingChannelError', { message: 'User is not in requested channel.' });
		console.log(`User ${user.username} left the '${channel}' channel.`);
		socket.to(channel).emit('systemMessage', { content: `User ${user.username} has left.`, timestamp: moment().format('YYYY-MM-DD') });
		socket.leave(channel);
		socket.emit('channelLeaveSuccess', (user, channel));
	});
});