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
		table;
	}).then(() => {
		knex('channels').insert({ name: 'general', topic: 'The beginning of it all.' })
		.then(() => {});
	});

	config.firstRun = false;
	writeFileSync(`./config.json`, JSON.stringify(config, null, '\t'));
}

const channels = new Map();

knex.select('*').from('channels').then(rows => {
	rows.map(channel => channels.set(channel.id, channel));
	// console.log(channels.get(1));
});

server.get('/', (req, res) => res.send('Ay, chatron server.'));

io.on('connection', socket => {
	socket.on('join', user => {
		console.log(`User ${user.username} connected to the ${user.channels.join(', ')} channel(s).`);
	});

	socket.on('leave', user => {
		console.log(`User ${user.username} disconnected.`);
	});

	socket.on('message', message => {
		// update stuff before this
		io.sockets.emit('update', {
			// emit updated stuff
		});
	});
});