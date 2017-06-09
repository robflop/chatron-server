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
		.then(() => {});
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
	socket.on('join', user => {
		if (usernames.includes(user.username)) return socket.emit('duplicateUsernameError', { message: 'Username is taken.' });
		console.log(`User ${user.username} connected and joined the '${user.channels.join('\', \'')}' channel(s).`);
		usernames.push(user.username);
		socket.join(user.channels);
	});

	socket.on('leave', user => {
		console.log(`User ${user.username} disconnected and left all channels.`);
		for (const channel of user.channels) {
			socket.to(channel).emit('systemMessage', { content: `User ${user.username} has left.`, timestamp: moment().format('YYYY-MM-DD') });
		}
		usernames.splice(usernames.indexOf(user.username), 1);
	});

	socket.on('message', message => {
		/*
		update stuff before this
		message properties: channel, author, content, timestamp
		*/
		io.sockets.emit('update', {
			// emit updated stuff
		});
	});

	socket.on('channelJoin', data => {
		const user = data.user, channel = data.channel;
		if (user.channels.includes(channel)) return socket.emit('duplicateChannelError', { message: 'User is already in requested channel.' });
		console.log(`User ${user.username} joined the '${channel}' channel.`);
		socket.join([channel]);
		socket.emit('channelJoin', (user, channel));
	});

	socket.on('channelLeave', data => {
		const user = data.user, channel = data.channel;
		if (!user.channels.includes(channel)) return socket.emit('missingChannelError', { message: 'User is not requested in channel.' });
		console.log(`User ${user.username} left the '${channel}' channel.`);
		socket.leave(channel);
		socket.emit('channelLeave', (user, channel));
	});
});