/**
 * Start HomingPigeon server
 */
var server = require('./appServer');
var lib = require('./lib');

//start server
server.server.listen(server.app.get('port'));
console.log('Server is listening to port ' + server.app.get('port') + '...');
lib.debug('Debug mode is enabled');