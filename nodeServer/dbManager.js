/**
 *  Interface for database access, data manipulation
 */
var mysql = require('mysql');

var pool = mysql.createPool({
    host :'localhost',
    port : 3306,
    user : 'root',
    password : 'team3',
    database:'HomingPigeon',
    connectionLimit:64,
    waitForConnections:true,
    acquireTimeout:60000
});

// this is called before connection is used
pool.on('connection', function (connection) {
	connection.query('SET NAMES UTF8');
	connection.query('SET AUTOCOMMIT=1');
});

// sql queries
var queries = {
	getUserByEmail: "SELECT * FROM Accounts WHERE email = ? ",

	getUserBySession: "SELECT * " +
			"FROM Accounts INNER JOIN Sessions ON Accounts.id = Sessions.accountId " +
			"where sessionId = ? ",

	getContactListByUser: "SELECT * " +
			"FROM ((SELECT c.id, a.email, a.nickname, a.picture, a.login, c.groupId " +
			"FROM Accounts a INNER JOIN Contacts c ON a.id = c.accountId " +
			"WHERE c.accountId2 = ?) " +
			"UNION " +
			"(SELECT c.id, a.email, a.nickname, a.picture, a.login, c.groupId " +
			"FROM Accounts a INNER JOIN Contacts c ON a.id = c.accountId2 " +
			"WHERE c.accountId = ?)) result " +
			"ORDER BY result.nickname ",

	getContact: "SELECT * " +
			"FROM ((SELECT c.id, a.email, a.nickname, a.picture, a.login, c.groupId " +
			"FROM Accounts a INNER JOIN Contacts c ON a.id = c.accountId " +
			"WHERE c.accountId2 = ? and a.id = ?) " +
			"UNION " +
			"(SELECT c.id, a.email, a.nickname, a.picture, a.login, c.groupId " +
			"FROM Accounts a INNER JOIN Contacts c ON a.id = c.accountId2 " +
			"WHERE c.accountId = ? and a.id = ?)) result " +
			"ORDER BY result.nickname ",

	getGroupListByUser: "SELECT g.id, g.name, g.alias, " +
			"g.nbMembers, max(m.date) as lastMessageDate " +
			"FROM Messages m RIGHT JOIN " +
			"(SELECT g.id, g.name, g.alias, count(*) as nbMembers " +
			"FROM GroupMembers gm INNER JOIN " +
			"(SELECT g.id, g.name, gm.alias " +
			"FROM Groups g INNER JOIN GroupMembers gm ON g.id = gm.groupId " +
			"WHERE gm.accountId = ? " +
			"LOCK IN SHARE MODE) g on g.id = gm.groupId " +
			"GROUP BY g.id " +
			"LOCK IN SHARE MODE) g on g.id = m.groupId " +
			"GROUP BY g.id " +
			"ORDER BY lastMessageDate desc ",

	getGroupMember: "SELECT * FROM GroupMembers " +
			"WHERE groupId = ? and accountId = ? ",

	getGroupMembers: "SELECT a.id, a.email, a.nickname, a.picture, a.login " +
			"FROM Accounts a INNER JOIN " +
			"(SELECT gm.accountId, gm.ackStart, gm.ackMessageId " +
			"FROM Groups g INNER JOIN GroupMembers gm ON g.id = gm.groupId " +
			"WHERE g.id = ? " +
			"LOCK IN SHARE MODE) m ON a.id = m.accountId " +
			"LOCK IN SHARE MODE ",

	getGroupMemberNumber: "SELECT count(*) " +
			"FROM Groups g INNER JOIN GroupMembers gm ON g.id = gm.groupId " +
			"WHERE g.groupId = ? ",

	getEventById: "SELECT * FROM Events WHERE id = ? ",

	getEventListByUser: "SELECT e.id, e.nbParticipants, e.nbParticipantsMax, " +
			"e.date, e.length, e.description, e.groupId " +
			"FROM Events e INNER JOIN EventParticipants ep ON e.id = ep.eventId " +
			"WHERE ep.accountId = ? ",

	getEventParticipants: "SELECT a.id, a.email, a.nickname, a.picture, a.login " +
			"FROM Accounts a INNER JOIN " +
			"(SELECT ep.accountId, ep.status " +
			"FROM Events e INNER JOIN EventParticipants ep ON e.id = ep.eventId " +
			"WHERE e.id = ?) p ON a.id = p.accountId ",

	getEventParticipantNumber: "SELECT nbParticipants FROM Events WHERE id = ? ",

	addUser: "INSERT INTO Accounts(email, password, login, nickname) VALUES(?)",

	addSession: "INSERT INTO Sessions(sessionId, accountId, expire) VALUES(?)",

	addContact: "INSERT INTO Contacts SET ?",

	addGroup: "INSERT INTO Groups SET ?",

	addGroupMember: "INSERT INTO GroupMembers SET ?",

	addMessage: "INSERT INTO Messages SET ?",

	addEvent: "INSERT INTO Events SET ?",

	addEventParticipant: "INSERT INTO EventParticipants SET ?",

	removeUser: "DELETE FROM Accounts WHERE email = ?",

	removeContact: "DELETE FROM Contacts " +
			"WHERE (accountId = ? and accountId2 = ?) or (accountId2 = ? and accountId = ?)",

	removeGroup: "DELETE FROM Groups WHERE id = ? ",

	removeGroupMember: "DELETE FROM GroupMembers WHERE groupId = ? and accountId = ? ",

	removeEvent: "DELETE FROM Events WHERE id = ? ",

	removeEventParticipant: "DELETE FROM EventParticipants WHERE eventId = ? and accountId = ? ",

	lastInsertId: "SELECT LAST_INSERT_ID() as lastInsertId"
};

var selectLock = function(query, data) {
	if (data.hasOwnProperty('lock') && data.lock) {
		return query + ' LOCK IN SHARE MODE';
	}
	if (data.hasOwnProperty('update') && data.update) {
		return query + ' FOR UPDATE';
	}
	return query;
}

// db operations
var dbPrototype = {
	release: function() {
		this.conn.release();
	},
	beginTransaction: function(callback) {
		this.conn.beginTransaction(callback);
	},
	commit: function(callback) {
		this.conn.commit(callback);
	},
	rollback: function(callback) {
		this.conn.rollback(callback);
	},
	query: function(query, args, callback) {
		this.conn.query(query, args, callback);
	},
	getUserByEmail: function(data, callback) {
		this.conn.query(selectLock(queries.getUserByEmail, data),
				[data.email], callback);
	},
	getUserBySession: function (data, callback) {
		this.conn.query(selectLock(queries.getUserBySession, data),
				[data.sessionId], callback);
	},
	getContactListByUser: function (data, callback) {
		this.conn.query(selectLock(queries.getContactListByUser, data),
				[data.userId, data.userId], callback);
	},
	// get info of userId2 contacted by userId
	getContact: function (data, callback) {
		this.conn.query(selectLock(queries.getContact, data),
				[data.userId, data.userId2, data.userId, data.userId2],
				callback);
	},
	getGroupListByUser: function (data, callback) {
		this.conn.query(selectLock(queries.getGroupListByUser, data),
				[data.userId], callback);
	},
	getGroupMember: function (data, callback) {
		this.conn.query(selectLock(queries.getGroupMember, data),
				[data.groupId, data.userId],
				callback);
	},
	getGroupMembers: function (data, callback) {
		this.conn.query(selectLock(queries.getGroupMembers, data),
				[data.groupId], callback);
	},
	getGroupMemberNumber: function (data, callback) {
		this.conn.query(selectLock(queries.getGroupMembers, data),
				[data.groupId], callback);
	},
	getEventById: function (data, callback) {
		this.conn.query(selectLock(queries.getEventById, data),
				[data.eventId], callback);
	},
	getEventListByUser: function (data, callback) {
		this.conn.query(selectLock(queries.getEventListByUser, data),
				[data.userId], callback);
	},
	getEventParticipants: function (data, callback) {
		this.conn.query(selectLock(queries.getEventParticipants, data),
				[data.eventId], callback);
	},
	getEventParticipantNumber: function (data, callback) {
		this.conn.query(selectLock(queries.getEventParticipantNumber, data),
				[data.eventId], callback);
	},
	addUser: function(data, callback)  {
		this.conn.query(queries.addUser,
				[[data.email, data.password, 'NO', data.nickname]], callback);
	},
	addSession: function(data, callback)  {
		this.conn.query(queries.addSession,
				[[data.sessionId, data.userId, data.expire]], callback);
	},
	addContact: function(data, callback)  {
		this.conn.query(queries.addContact,
				{accountId:data.userId, accountId2:data.userId2}, callback);
	},
	addGroup: function(data, callback)  {
		this.conn.query(queries.addGroup,
				{name:data.name}, callback);
	},
	addGroupMember: function(data, callback)  {
		this.conn.query(queries.addGroupMember,
				{groupId:data.groupId, accountId:data.userId,
			ackStart:data.ackStart}, callback);
	},
	addMessage: function(data, callback)  {
		this.conn.query(queries.addMessage,
				{groupId:data.groupId, accountId:data.userId, nbread:1,
			importance:data.importance, content:data.content,
			location:data.location}, callback);
	},
	addEvent: function(data, callback)  {
		this.conn.query(queries.addEvent,
				{nbParticipants:0, nbParticipantsMax:data.nbParticipantsMax,
			length:data.length, date:data.date, description:data.description,
			groupId:data.groupId}, callback);
	},
	addEventParticipant: function(data, callback)  {
		this.conn.query(queries.addEventParticipant,
				{eventId:data.eventId, accountId:data.userId,
			status:data.status}, callback);
	},
	removeUser: function(data, callback)  {
		this.conn.query(queries.removeUser, [data.email], callback);
	},
	removeContact: function(data, callback)  {
		this.conn.query(queries.removeContact,
				[data.userId, data.userId2, data.userId, data.userId2],
				callback);
	},
	removeGroup: function(data, callback)  {
		this.conn.query(queries.removeGroup, [data.groupId], callback);
	},
	removeGroupMember: function(data, callback)  {
		this.conn.query(queries.removeGroupMember,
				[data.groupId, data.userId], callback);
	},
	removeEvent: function(data, callback)  {
		this.conn.query(queries.removeEvent, [data.eventId], callback);
	},
	removeEventParticipant: function(data, callback)  {
		this.conn.query(queries.removeEventParticipant,
				[data.eventId, data.userId], callback);
	},
	lastInsertId: function(callback)  {
		this.conn.query(queries.lastInsertId, callback);
	},
};

function db() {

}
db.prototype = dbPrototype;

module.exports = {
	getConnection: function(callback) {
		var dbInstance = new db();
		pool.getConnection(function(err, conn) {
			if (err) {
				console.log('Failed to get db connection');
				Object.defineProperty(dbInstance, 'conn',
						{value: null, configurable: false, writable: false, enumerable: false});
			} else {
				Object.defineProperty(dbInstance, 'conn',
						{value: conn, configurable: false, writable: false, enumerable: false});
			}
			callback(err, dbInstance);
		})
	}
};

// test codes
// this is how to use

if (require.main == module) {
	console.log('file: ' + __filename + '\ndir: ' + __dirname);

	test1();
	// code without async
	function test1() {
		var manager = require('./dbManager');

		console.log('request connection');
		manager.getConnection(function(err, conn) {
			if (err)
				throw err;
			console.log('start transaction');
			conn.beginTransaction(function(err) {
				if (err) {
					conn.release();
					throw err;
				}
				console.log('insert an account');
				conn.addUser({email:'test@kaist.ac.kr', password:'1234567890', nickname: 'test'}, function(err, result) {
					if(err) {
						conn.rollback(function() {
							conn.release();
							throw err;
						});
					}
					console.log('select account');
					conn.getUserByEmail({email:'test@kaist.ac.kr'}, function(err, result) {
						if(err) {
							conn.rollback(function() {
								conn.release();
								throw err;
							});
						}
						for (var i = 0; i < result.length; i++) {
							console.log('id: ' + result[i].email + '(' + typeof result[i].email + ')');
							console.log('pwd: ' + result[i].password + '(' + typeof result[i].password + ')');
						}
						console.log('delete account');
						conn.removeUser({email:'test@kaist.ac.kr'}, function(err, result) {
							if(err) {
								conn.rollback(function() {
									conn.release();
									throw err;
								});
							}
							console.log('commit');
							conn.commit(function(err) {
								if(err) {
									conn.rollback(function() {
										conn.release();
										throw err;
									});
								}
								console.log('release connection');
								conn.release();
								setTimeout(test2, 0);
							});
						});
					});
				});
			});
		});
	}

	// code doing same thing as above, but with async
	// this is more readable and no callback nesting, easy to write
	function test2() {
		var manager = require('./dbManager');
		var async = require('async');

		var connection;
		async.waterfall([
			function(callback) {
				manager.getConnection(callback);
			},
			function(conn, callback) {
				connection = conn;
				connection.beginTransaction(callback);
			},
			function(result, fields, callback) {
				connection.addUser({email:'test@kaist.ac.kr', password:'1234567890', nickname: 'test'}, callback);
			},
			function(result, fields, callback) {
				connection.getUserByEmail({email:'test@kaist.ac.kr'}, callback);
			},
			function(result, fields, callback) {
				for (var i = 0; i < result.length; i++) {
					console.log('id: ' + result[i].email + '(' + typeof result[i].email + ')');
					console.log('pwd: ' + result[i].password + '(' + typeof result[i].password + ')');
				}
				callback(null);
			},
			function(callback) {
				connection.removeUser({email:'test@kaist.ac.kr'}, callback);
			},
			function(result, fields, callback) {
				connection.commit(callback);
			},
			function(result, fields, callback) {
				callback(null, 'done');
			}
		],
		function(err, results) {
			if (err) {
				if (connection) {
					connection.rollback(function() {
						console.log('rolled back');
						if (connection) {
							connection.release();
						}
						process.exit();
					});
				}
				throw err;
			}
			if (connection) {
				connection.release();
			}
			process.exit();
		});
	}
}
