/**
 * Contact list management
 * a user can add, remove contacts and get contact list
 */
var dbManager = require('./dbManager');

var init = function(user) {
	/* User operations
	 * name              arguments
	 * getContactList    
	 * addContact        email
	 * removeContact     email
	 * acceptContact     email
	 * denyContact       email
	 */
	
	/* User events
	 * name
	 * newPendingContact
	 * contactRemoved
	 * newContact
	 * contactDenied
	 */
	user.on('getContactList', function() {
		if (!session.validateRequest('getContactList', user, false))
			return;
		
		dbManager.trxPattern([
			function(callback) {
				getAcceptedContactList({user: user, db: this.db}, callback);
			},
			function(result, callback) {
				var contactList = lib.filterUsersData(result);
				
				var event = user.emitter.pushEvent('getContactList', {status: 'success', contacts: contactList});
				
				callback(null, event);
			}
		],
		function(err, event) {
			if (err) {
				lib.debug('failed to get contact list\r\n' + err);
				if (event != null) {
					event.cancelEvent();
				}
				user.emit('getContactList', {status: 'fail', errorMsg:'server error'});
			} else if (event != null) {
				event.fireEvent();
			}
		});
	});
	
	user.on('getPendingContactList', function() {
		if (!session.validateRequest('getPendingContactList', user, false))
			return;
		
		dbManager.trxPattern([
			function(callback) {
				getPendingContactList({user: user, db: this.db}, callback);
			},
			function(result, callback) {
				var pendingContactList = lib.filterUsersData(result);
				
				var event = user.emitter.pushEvent('getPendingContactList', 
						{status: 'success', contacts: pendingContactList});
				
				callback(null, event);
			}
		],
		function(err, event) {
			if (err) {
				lib.debug('failed to get pending contact list\r\n' + err);
				if (event != null) {
					event.cancelEvent();
				}
				user.emit('getPendingContactList', {status: 'fail', errorMsg:'server error'});
			} else if (event != null) {
				event.fireEvent();
			}
		});
	});
	
	user.on('addContact', function(data) {
		if (!session.validateRequest('addContact', user, true, data))
			return;
		
		var peerId, peerData;
		dbManager.trxPattern([
			function(callback) {
				this.db.getUserByEmail({email: data.email, lock: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length < 1)
					return callback(new Error('contact not found'));
				
				this.data.peer = result[0];
				var peerId = result[0].userId;
				
				if (peerId == user.userId)
					return callback(new Error('cannot add self contact'));
				
				this.db.getContact({userId: user.userId, userId2: peerId, lock: true}, 
						callback);
			},
			function(result, fields, callback) {
				if (result.length > 0)
					return callback(new Error('contact already exists'));
				
				var peerId = this.data.peer.userId;
				
				this.db.addContact({requestUserId: user.userId, acceptUserId: peerId}, callback);
			},
			function(result, fields, callback) {
				if (result.affectedRows < 1)
					return callback(new Error('failed to add contact'));
				
				var peer = this.data.peer;
				var peerId = peer.userId;
				
				// notify user and peer sessions new pending contact
				var sessions = session.getUsersSessions([user, {userId: peerId}]);
				
				var i = 0;
				var events = [];
				if (sessions) {
					sessions.forEach(function(session) {
						if (session.userId == peer.userId) {
							var jsonResult = user.getUserInfo();
							jsonResult.invited = 1;
							events.push(session.emitter.pushEvent(
									'newPendingContact', {status: 'success', contact: jsonResult}));
						} else if (session.userId == user.userId) {
							var jsonResult = lib.filterUserData(peer);
							jsonResult.invited = 0;
							events.push(session.emitter.pushEvent(
									'newPendingContact', {status: 'success', contact: jsonResult}));
						} else {
							throw new Error('bad session');
						}
						
						i++;
						if (i == sessions.length)
							callback(events);
					});
				} else
					callback(events);
			}
		], 
		function(err, events) {
			if (err) {
				lib.debug('failed to add contact\r\n' + err);
				if (events != null) {
					for (var i in events) {
						event[i].cancelEvent();
					}
				}
				return user.emit('addContact', {status: 'fail', errorMsg: 'server error'});
			} else if (events != null) {
				for (var i in events) {
					events[i].fireEvent();
				}
			}
		});
	});
	
	user.on('removeContact', function(data) {
		if (!session.validateRequest('removeContact', user, true, data))
			return;
		
		var db;
		dbManager.trxPattern([
			function(callback) {
				this.db.getUserByEmail({email: data.email, lock: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length < 1)
					return callback(new Error('contact not found'));
				
				this.data.peer = result[0];
				var peerId = result[0].userId;
				
				this.db.removeContact({userId: user.userId, userId2: peerId}, callback);
			},
			function(result, fields, callback) {
				if (result.affectedRows == 0) {
					return callback(new Error('cannot find contact'));
				}
				
				var peerId = this.data.peer.userId;
				var peerEmail = this.data.peer.email;
				var sessions = session.getUsersSessions([user, {userId: peerId}]);
				
				// notify every session of the other peer
				var i = 0;
				var events = [];
				if (sessions) {
					sessions.forEach(function(session) {
						if (session.userId == peerId)
							events.push(session.emitter.pushEvent('contactRemoved', 
									{status: 'success', userId: user.userId, email: user.email}));
						else if (session.userId == user.userId)
							events.push(session.emitter.pushEvent('contactRemoved', 
									{status: 'success', userId: peerId, email: peerEmail}));
						else 
							throw new Error('bad session');
						
						i++;
						if (i == sessions.length)
							callback(events);
					});
				} else
					callback(events);
			}
		], 
		function(err, events) {
			if (err) {
				lib.debug('error when to remove contact\r\n' + err);
				if (events != null) {
					for (var i in events) {
						events[i].cancelEvent();
					}
				}
				return user.emit('removeContact', {status: 'fail', errorMsg: 'server error'});
			} else if (events != null) {
				for (var i in events) {
					events[i].fireEvent();
				}
			}
		});
	});
	
	// user accept pending contact, notify 
	user.on('acceptContact', function(data) {
		if (!session.validateRequest('acceptContact', user, true, data))
			return;
		
		dbManager.trxPattern([
			function(callback) {
				reactPendingContact({user: user, email: data.email, accept: true, db: this.db}, 
						callback);
			}
		],
		function(err, events) {
			if (err) {
				lib.debug('error when to accept contact\r\n' + err);
				if (events != null) {
					for (var i in events) {
						events[i].cancelEvent();
					}
				}
				return user.emit('acceptContact', {status: 'fail', errorMsg: 'server error'});
			} else if (events != null) {
				for (var i in events) {
					events[i].fireEvent();
				}
			}
		});
	});
	
	// user accept pending contact, notify 
	user.on('denyContact', function(data) {
		if (!session.validateRequest('denyContact', user, true, data))
			return;
		
		dbManager.trxPattern([
			function(callback) {
				reactPendingContact({user: user, email: data.email, accept: false, db: this.db}, 
						callback);
			}
		],
		function(err, events) {
			if (err) {
				lib.debug('error when to deny contact\r\n' + err);
				if (events != null) {
					for (var i in events) {
						events[i].cancelEvent();
					}
				}
				return user.emit('denyContact', {status: 'fail', errorMsg: 'server error'});
			} else if (events != null) {
				for (var i in events) {
					events[i].fireEvent();
				}
			}
		});
	});
}

var getAcceptedContactList = function(data, callback) {
	var user = data.user
	
	if (data.trx)
		pattern = dbManager.trxPattern;
	else
		pattern = dbManager.atomicPattern;
	
	pattern([
		function(callback) {
			this.db.getAcceptedContactListByUser({userId: user.userId,
				lock: true}, callback);
		}
	], 
	function(err, result) {
		if (err) {
			callback(err);
		} else {
			callback(null, result)
		}
	},
	{db: data.db});
};

var getPendingContactList = function(data, callback) {
	var user = data.user
	
	if (data.trx)
		pattern = dbManager.trxPattern;
	else
		pattern = dbManager.atomicPattern;
	
	pattern([
		function(callback) {
			this.db.getPendingContactListByUser({userId: user.userId,
				lock: true}, callback);
		}
	], 
	function(err, result) {
		if (err) {
			callback(err);
		} else {
			callback(null, result);
		}
	},
	{db: data.db});
};

// input: data.user, data.email(peer email), data.accept(bool)
var reactPendingContact = function(data, callback) {
	var user = data.user
	var accept = data.accept
	
	if (data.trx)
		pattern = dbManager.trxPattern;
	else
		pattern = dbManager.atomicPattern;
	
	pattern([
		function(callback) {
			this.db.getUserByEmail({email: data.email, lock: true}, callback);
		},
		function(result, fields, callback) {
			if (result.length == 0)
				return callback(Error('No such user'));
			
			var peer = result[0];
			this.data.peer = peer;
			
			this.db.getPendingContact({userId: user.userId, userId2: peer.userId, lock: true},
					callback);
		},
		function(result, fields, callback) {
			if (result.length == 0)
				return callback(new Error('You don\'t have such waiting contact'));
			
			if (accept && result[0].requestUserId == user.userId) {
				return callback(new Error('You already accepted contact'));
			}
			
			var peerId = this.data.peer.userId;
			
			if (accept)
				this.db.acceptPendingContact({userId: user.userId, userId2: peerId},
						callback);
			else
				this.db.removePendingContact({userId: user.userId, userId2: peerId},
						callback);
		},
		function(result, fields, callback) {
			var peer = this.data.peer;
			var peerId = this.data.peer.userId;
			
			// notify both users
			var sessions = session.getUsersSessions([user, {userId: peerId}]);
			
			var i = 0;
			var events = [];
			if (sessions) {
				sessions.forEach(function(session) {
					if (session.userId == peerId) {
						
						if (accept)
							events.push(session.emitter.pushEvent(
									'newContact', {status:'success', contact: user.getUserInfo()}));
						else
							events.push(session.emitter.pushEvent(
									'contactDenied', {status:'success', contact: user.getUserInfo()}));
						
					} else if(session.userId == user.userId) {
						
						if (accept)
							events.push(session.emitter.pushEvent(
									'newContact', {status:'success', contact: lib.filterUserData(peer)}));
						else
							events.push(session.emitter.pushEvent(
									'contactDenied', {status:'success', contact: lib.filterUserData(peer)}));
						
					} else
						throw new Error('bad session');
					
					i++;
					if (i == sessions.length)
						callback(events);
				});
			} else
				callback(events);
		}
	],
	function(err) {
		callback(err);
	},
	{db: data.db});
}

module.exports = {init: init,};

var session = require('./session');
var lib = require('./lib');
var async = require('async');
