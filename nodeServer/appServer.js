/** 
 * HomingPigeon application server entry point 
 **/
//parse command line arguments
function parseArgs() {
	var argv = process.argv;
	var args = [];
	for (var i = 1; i < argv.length; i++) { 
		var argKey = argv[i];
		
		if (argKey.startsWith('--'))
			argKey = argKey.slice(2);
		else if (argKey.startsWith('-'))
			argKey = argKey.slice(1);
		else 
			continue;
		
		if (i + 1 < argv.length && !argv[i+1].startsWith('-')) 
			args.push({key: argKey, value: argv[++i]});
		else 
			args.push({key: argKey, value: null});
	}

	for (var i = 0; i < args.length; i++) {
		var arg = args[i];
		switch(arg.key) {
		case 'debug':
			process.env.DEBUG = true;
			break;
		case 'port':
			assertArgValue(arg.value, 'Please put port number!');
			process.env.PORT = arg.value;
			break;
		case 'help':
		case 'h':
			getHelpMessage();
			break;
			
		default:
			console.log('Unknown argument - ' + arg.key + '\r\n');
			console.log('If you need help, put --help or -h argument');
			process.exit(1);
		}
	}
}

function assertArgValue(value, errorMsg) {
	if(value == null) {
		console.log(errorMsg);
		process.exit(1);
	}
}

function getHelpMessage() {
	var helpMsg = ('PokoTalk server command line arguments must be one of them\r\n' +
	'--debug : enable debug mode, show log messages in console\r\n' + 
	'--port  : server listen to specified port\r\n');
	console.log(helpMsg);
	process.exit(1);
}

parseArgs();

//initialize server
var fs = require('fs');
var app = require('express')();
app.set('port', process.env.PORT || 4000);
var options = {
		  key: fs.readFileSync(__dirname + '/ssl/file.pem'),
		  cert: fs.readFileSync(__dirname + '/ssl/file.crt')
		};
var server = require('https').createServer(options, app);
var io = require('socket.io')(server);

app.get('/', function(req, res){
	lib.debug('https request');
	res.send('<h1>Hello world</h1>');
});


//initialize user connection
io.on('connection', function(user) {
	lib.debug('user connected');
	
	session.init(user);
	contact.init(user);
	group.init(user);
	chatManager.init(user);
	event.init(user);
});

module.exports = {io: io, server: server, app: app};

var async = require('async');
var dbManager = require('./dbManager');
var contact = require('./contact');
var session = require('./session');
var group = require('./group');
var event = require('./event');
var chatManager = require('./chatManager');
var chat = require('./chat');
var lib = require('./lib');