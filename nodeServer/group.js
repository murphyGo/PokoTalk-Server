/**
 * Group management
 * user can create group chat for 2 or more users
 */
var dbManager = require('./dbManager');

function init(user) {
	// make sure client update group list on addGroup, joinContactChat, getGroupList
	
	/* User operations
	 * name               arguments
	 * getGroupList       
	 * addGroup           name, members(array of email)
	 * inviteGroupMembers groupId, members(array of email)
	 * exitGroup          groupId
	 */
	
	/* User events 
	 * name
	 * membersInvited
	 * membersExit
	 */
	
	// get group list of the user
	// input : None
	// output : {status: 'success' or 'fail', groups: array of groups, errorMsg: error message}
	user.on('getGroupList', function() {
		if (!session.validateRequest('getGroupList', user, false))
			return;
		
		lib.debug('get group list for ' + user.email);
		
		dbManager.trxPattern([
			function(callback) {
				getGroupList({user: user, db: this.db}, callback);
			},
			function(result, callback) {
				this.pushEvent(user, 'getGroupList', {groups: result});
				
				callback(null);
			}
		],
		function(err) {
			if (err) {	
				lib.debug('failed to get group list\r\n' + err);

				user.emit('getGroupList', {status: 'fail', errorMsg:'server error'});
			} 
		});
	});
	
	// add group and add initial members to group
	// input : {name: group name, members: array of email}
	// output : {status: 'success' or 'fail', errorMsg: error message}
	user.on('addGroup', function(data) {
		if (!session.validateRequest('addGroup', user, true, data))
			return;
		
		var name = data.name;
		var members = data.members;
		
		// Check if name is String
		if (name != null && typeof name != 'string') {
			return;
		}
		
		// Check if members is Array
		if (members != null && typeof members != 'object' && members.constructor != Array) {
			return;
		}
		
		dbManager.trxPattern([
			function(callback) {
				// add user itself to group
				var data = {user: user, name: name, members: members, db: this.db};
				
				addGroup(data, callback);
			},
			function(group, callback) {
				this.data.group = group;
				
				var addedMembers = group.members.filter(function(member) {
					return member.userId != user.userId;
				});
				
				addMemberJoinMessageAndAddHistory({user: user, groupId: group.groupId,
					addedMembers: addedMembers, db: this.db}, callback);
			},
			function(message, callback) {
				this.data.message = message;
				
				var group = this.data.group;
				var sessions = session.getUsersSessions(group.members);
				
				// notify every online member
				for (var i = 0; i < sessions.length; i++) {
					this.pushEvent(sessions[i], 'addGroup', {group: group});
				}
				
				// join every member to group chat
				chatManager.joinGroupChat({groupId: group.groupId, users: sessions}, function(err) {
					if (err) {
						return callback(err);
					} else {
						return callback(null);
					}
				});
			},
		],
		function(err) {
			if (err) {
				var group = this.data.group;
				if (group) {
					// remove group chat
					chatManager.removeGroupChatByGroupId(group.groupId);
				}
				
				user.emit('addGroup', {status: 'fail', errorMsg:'server error'});
			} else {
				var group = this.data.group;
				var members = group.members;
				var message = this.data.message;
				
				if (message) {
					// send join message in background
					setTimeout(function() {
						chatManager.sendMessage({user: user, groupId: group.groupId, 
							messageId: message.messageId, toMe: true, trx: true}, 
							function(err) {
								if (err) {
									lib.debug(err);
								}
							});
					}, 0);
				}
			}
		});
	});
	
	// invite contacts to group
	user.on('inviteGroupMembers', function(data) {
		if (!session.validateRequest('inviteGroupMembers', user, true, data))
			return;
		
		var members = data.members;
		var groupId = parseInt(data.groupId);
		// ignore invalid group id
		if (groupId !== groupId)
			return;
		
		dbManager.trxPattern([
			function(callback) {
				this.db.getGroupMemberByUser({groupId: groupId, 
					userId: user.userId, lock: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('You are not a group member or no such group'));
				
				if (!groupId)
					return callback(new Error('no group id'));
				
				// members should be array
				if (lib.isArray(members)) {
					addMembers({db: this.db, groupId: groupId, user: user, 
						members: members}, callback);
				} else {
					callback(new Error('not array'));
				}
			},
			function(invitedMembers, callback) {
				this.data.invitedMembers = lib.filterUsersData(invitedMembers);
				
				// Add member join message and history
				addMemberJoinMessageAndAddHistory({user: user, groupId: groupId,
					addedMembers: invitedMembers, db: this.db}, callback);
			},
			function(message, callback) {
				this.data.message = message;
				
				invalidateContactGroup({groupId: groupId, 
					db: this.db}, callback);
			},
			function(contact, callback) {
				this.data.contact = contact;
				
				// get group info
				this.db.getGroupById({groupId: groupId, lock: true}, callback);
			},
			function(result, fields, callback) {
				this.data.group = result[0];
				
				// get group member info
				this.db.getGroupMembers({groupId: groupId, lock: true}, callback);
			},
			// send any notifications
			// this must be sent before commit
			function(result, fields, callback) {	
				var group = this.data.group;
				var invitedMembers = this.data.invitedMembers;
				var totalMembers = result;
				var contact = this.data.contact;
				var events = [];
				
				if (contact) {
					events = events.concat(emitContactChatRemoved(groupId, contact));
				}
				
				// get every session of every member
				var totalSessions = session.getUsersSessions(totalMembers);
				var invitedSessions = session.getUsersSessions(invitedMembers);
				this.data.invitedSessions = invitedSessions;
				
				group.members = totalMembers;
				group = lib.filterGroupData(group);
				
				// notify every online member
				for (var i = 0; i < totalSessions.length; i++) {
					var userSession = totalSessions[i];
					if (invitedSessions.indexOf(userSession) >= 0) {
						events.push(userSession.emitter.pushEvent('addGroup', {status: 'success', group: group}));
					} else {
						events.push(userSession.emitter.pushEvent('membersInvited', 
								{status: 'success', groupId: group.groupId, members: invitedMembers}));
					}
				}
				
				chatManager.joinGroupChat({groupId: groupId, users: invitedSessions}, function(err) {
					if (err) {
						return callback(err, events);
					} else {
						return callback(null, events);
					}
				});
			}
		],
		function(err, events) {
			if (err) {
				lib.debug('failed to invite users to group\r\n' + err);
				if (events) {
					for (var i in events) {
						events[i].cancelEvent();
					}
				}
				
				var invitedSessions = this.data.invitedSessions;
				
				// Invited sessions must leave group chat
				chatManager.leaveGroupChat({groupId: groupId, users: invitedSessions}, function(err) {
					if (err) {
						lib.deubg(err);
					}
				});
				
				return user.emit('inviteGroupMembers', {status: 'fail', errorMsg:'server error'});
			} else {
				for (var i in events) {
					events[i].fireEvent();
				}
				
				var message = this.data.message;
				var group = this.data.group;
				
				if (message) {
					// send join message in background
					setTimeout(function() {
						chatManager.sendMessage({user: user, groupId: group.groupId, 
							messageId: message.messageId, toMe: true, trx: true}, 
							function(err) {
								if (err) {
									lib.debug(err);
								}
						});
					}, 0);
				}
			}
		});
	});
	
	// User exits from group
	user.on('exitGroup', function(data) {
		if (!session.validateRequest('exitGroup', user, true, data))
			return;
		
		var groupId = parseInt(data.groupId);
		// ignore invalid group id
		if (groupId !== groupId)
			return;
		
		dbManager.trxPattern([
			function(callback) {
				exitGroup({groupId: groupId, user: user}, callback);
			}
		],
		function(err, message, events) {
			if (err) {
				if (events) {
					for (var i in events) {
						events[i].cancelEvent();
					}
				}
				
				user.emit('exitGroup', {status: 'fail', errorMsg:'server error'});
			} else {
				for (var i in events) {
					events[i].fireEvent();
				}
				
				if (message) {
					// Send member exit message
					setTimeout(function() {
						chatManager.sendMessage({user: user, groupId: groupId, 
							messageId: message.messageId, trx: true}, 
							function(err) {
								if(err) {
									lib.debug(err);
								}
							});
					}, 0);
				}
			}
		});
	});
}

// create new group and chat room and notify members
// input: data.user, data.name(group name), data.members(array of email)

//DEPRECATED
var addGroupAndStartChat = dbManager.composablePattern(function(pattern, callback) {
	var user = this.data.user;
	
	pattern([
		function(callback) {
			this.data.db = this.db;
			this.data.trx = false;
			
			// add group and members in database
			addGroup(this.data, callback);
		},
		function(group, callback) {
			var members = group.members;
			// get every session of every member
			var sessions = session.getUsersSessions(members);
			
			this.data.group = group;
			this.data.sessions = sessions;
			
			// create chatRoom and join every online members
			chatManager.joinGroupChat({groupId: group.groupId, 
				users: sessions, db: this.db}, callback);
		}
	],
	function(err) {
		if (err) {
			callback(err);
		} else {
			var groupId = this.data.group.groupId;
			
			callback(null, this.data.group, this.data.sessions);
		}
	});
});

// get group list of user
// input: data.user
var getGroupList = function(data, callback) {
	var pattern;
	
	var user = data.user;
	
	if (data.trx)
		pattern = dbManager.trxPattern;
	else
		pattern = dbManager.atomicPattern;
	
	pattern([
		function(callback) {
			// get group list of the user
			this.db.getGroupListByUser({userId: user.userId, lock: true}, callback);
		},
		function(result, fields, callback) {
			var groups = result;
			var db = this.db;
			
			// get all group member information of all group
			var getMembers = function (i) {
				if (i >= groups.length)
					return callback(null, groups);
				
				db.getGroupMembers({groupId: groups[i].groupId, lock: true}, function(err, members) {
					if (err)
						return callback(err);
					
					groups[i].members = [];
					
					for (var j = 0; j < members.length; j++)
						groups[i].members.push(lib.filterUserData(members[j]));
					
					getMembers(i + 1);
				});
			}
			getMembers(0);
		},
		function(result, callback) {
			var groups = result;
			var db = this.db;
			
			// get last message of all group 
			var getLastMessages = function (i) {
				if (i >= groups.length)
					return callback(null, groups);
				
				db.getLastMessageOfGroup({groupId: groups[i].groupId}, function(err, result) {
					if (err)
						return callback(err);
					
					if (result.length > 0) {
						groups[i].lastMessage = lib.filterMessageData(result[0]);
						
						// for compartibility
						groups[i].id = groups[i].groupId;
						
						groups[i] = lib.filterGroupData(groups[i]);
					}
					
					getLastMessages(i + 1);
				});
			}
			getLastMessages(0);
		}
	],
	function(err, result) {
		if (err) {	
			lib.debug('failed to get group list\r\n' + err);
			
			callback(err);
		} else {
			callback(null, result);
		}
	},
	{db: data.db});
	
};

// create group and members in database
// input: data.user, data.name, data.members
// TODO: event group add
var addGroup = dbManager.composablePattern(function(pattern, callback){
	var groupId;
	var user = this.data.user
	var name = this.data.name;
	var members = this.data.members;
	
	// remove invalid emails
	members = members.filter(function(email) {return email;});
	
	pattern([
		// create group
		function(callback) {
			this.db.addGroup({name: name}, callback);
		},
		// get group id
		function(result, fields, callback) {
			if (result.affectedRows == 0)
				return callback(new Error('failed to add group'));
			
			this.db.lastInsertId(callback);
		},
		// add members to group
		function(result, fields, callback) {
			if (result.length == 0)
				return callback(new Error('no last insert id'));
			
			groupId = result[0].lastInsertId;
			
			// members should be array
			if (lib.isArray(members)) {
				// add calling user as a member
				if (user && !contains.call(members, user.email))
					members.unshift(user.email);
				
				addMembers({db: this.db, groupId: groupId, user: user, 
					members: members}, callback);
			} else {
				callback(new Error('not array'));
			}
		},
		// if no group name, add default name
		function(result, callback) {
			// get group member information
			members = result;
			this.data.members = members;
			
			if (name) 
				return callback(null, false, null);
			
			name = getDefaultGroupName(members);
			this.db.updateGroupName({groupId: groupId, name: name},
					function(err, result, fields) {
				callback(err, true, result);
			});
		},
		// get group info
		function(updated, result, callback) {
			if (updated && result.affectedRows == 0)
				return callback(new Error('failed to update name'));
			
			this.db.getGroupById({groupId: groupId, lock: true}, callback);
		},
		function(result, fields, callback) {
			if (result.length == 0)
				return callback(new Error('no group info'));
			
			var group = result[0];
			
			this.data.group = group;
			group.members = this.data.members;
			
			callback(null);
		}
	],
	function(err) {
		if (err) {
			lib.debug('failed to add group list\r\n' + err);
			
			callback(err);
		} else {
			var result = lib.filterGroupData(this.data.group);
			callback(null, result);
		}
	}, {db: this.data.db});
});

// 'user' adds users in 'members' to group 'groupId', calling 'callback' at the end
var addMembers = dbManager.composablePattern(function(pattern, callback) {
	var addedMembers = [];
	
	var groupId = this.data.groupId;
	var user = this.data.user;
	var members = this.data.members;
	
	if (!members)
		return callback(null, addedMembers);
	//console.log(members);
	pattern([
		// process data from client
		function(callback) {
			var db = this.db;
			
			// recursive function adding multiple users to group
			lib.recursion(function(i) {
				return i < members.length;
			},
			function(i, rCallback) {
				var peer;

				dbManager.atomicPattern([
					// process data from client
					function(callback) {
						var email = members[i];
						if (email)
							email = email.toString().trim();
						
						// get user info
						this.db.getUserByEmail({email: email, lock: true}, callback);
					},
					function(result, fields, callback) {
						if (result.length == 0)
							return rCallback(null);
						
						peer = result[0];
						
						// don't check if user is null or user adds itself
						if (!user || user.userId == peer.id)
							return callback(null, true, null, null);
						
						// user can invite only contacts
						this.db.getAcceptedContact({userId: user.userId, userId2: peer.id, lock: true}, 
						function(err, result, fields) {
							callback(err, false, result, fields);
						});
					},
					function(self, result, fields, callback) {
						if (!self && result.length == 0)
							return callback(new Error('You can add only your contacts'));
						
						// check if the member added already
						this.db.getGroupMemberByUser({groupId: groupId, userId: peer.id, lock: true},
								callback);
					},
					function(result, fields, callback) {
						// ignore already added member
						if (result.length > 0)
							return rCallback(null);
						
						this.db.addGroupMember({groupId: groupId, userId: peer.id}, callback);
					},
					function(result, fields, callback) {
						if (result.affectedRows < 1)
							return callback(new Error('failed to insert member'));
						
						// push added user
						addedMembers.push(lib.filterUserData(peer));
						
						callback(null);
					}
				],
				function(err) {
					rCallback(err);
				},
				{db: db});
			},
			callback);
		}
	],
	function(err) {
		if (err) {
			callback(err);
		} else {
			callback(null, addedMembers);
		}
	}, {db: this.data.db});
});

var addMemberJoinMessageAndAddHistory = dbManager.composablePattern(function(pattern, callback) {
	var groupId = this.data.groupId;
	var user = this.data.user;
	var addedMembers = this.data.addedMembers;
	
	addedMembers = addedMembers.filter(function(member) {
		return member.userId != user.userId;
	});
	
	pattern([
		function(callback) {
			// avoid when user creates group alone
			if (addedMembers.length == 0) {
				return callback(null, null);
			}
			
			var data = {user: user, groupId: groupId,
					messageType: chatManager.messageType.joinGroup,
					content: '', importance: 0, location: null, toMe: true,
					db: this.db};
			
			// add member invited message
			chatManager.addMessage(data, callback);
		},
		function(message, callback) {
			this.data.message = message;
			
			var db = this.db;
			
			// add member join history
			lib.recursion(function(i) {
				return i < addedMembers.length;
			},
			function(i, rCallback) {
				dbManager.atomicPattern([
					function(callback) {
						var member = addedMembers[i];
						
						if (member.userId != user.userId) {
							this.db.addMemberJoinHistory({groupId: groupId, 
								messageId: message.messageId, userId: member.userId}, callback);
						} else {
							callback(null);
						}
					}
				],
				function(err) {
					rCallback(err);
				},
				{db: db});
			},
			callback);
		}
	],
	function(err) {
		if (err) {
			return callback(err);
		} else {
			return callback(null, this.data.message);
		}
	}, {db: this.data.db});
});

var exitGroup = dbManager.composablePattern(function(pattern, callback) {
	var groupId = this.data.groupId;
	var user = this.data.user;
	var events = [];
	
	pattern([
		function(callback) {
			this.db.getGroupMemberByUser({groupId: groupId, 
				userId: user.userId, update: true}, callback);
		},
		function(result, fields, callback) {
			if (result.length == 0) {
				return callback(new Error('you are not a member of group'));
			}
			
			this.db.removeGroupMember({groupId: groupId, 
				userId: user.userId}, callback);
		},
		function(result, fields, callback) {
			if (result.affectedRows === 0) {
				return callback(new Error('failed to remove user from group'));
			}
			
			invalidateContactGroup({groupId: groupId, db: this.db}, 
					callback);
		},
		function(contact, callback) {
			this.data.contact = contact;
			
			// remove group if there's no member in group
			this.db.removeGroupIfNoMember({groupId: groupId, lock: true}, 
					callback);
		},
		function(result, fields, callback) {
			if (result.affectedRows > 0) {
				lib.debug('group ' + groupId + ' is removed from db');
				this.data.removed = true;
			}
			
			// get group member info
			this.db.getGroupMembers({groupId: groupId, lock: true}, callback);
		},
		function(result, fields, callback) {
			this.data.totalMembers = result;
			
			// leave group chat
			chatManager.leaveGroupChat({groupId: groupId, users: [user],
				db: this.db}, callback);
		},
		function(callback) {
			var totalMembers = this.data.totalMembers;
			var contact = this.data.contact;
			this.data.totalMembers = totalMembers;
			
			if (contact) {
				events = events.concat(emitContactChatRemoved(groupId, contact));
			}
			
			// notify remaining users
			var totalSessions = session.getUsersSessions(totalMembers);
			
			// notify every online member
			for (var i = 0; i < totalSessions.length; i++) {
				var userSession = totalSessions[i];
				
				events.push(userSession.emitter.pushEvent('membersExit', 
						{status:'success', groupId: groupId, members: [user.getUserInfo()]}));
			}
			
			// notify the user
			var sessions = session.getUserSessions(user);
			
			for(var i = 0; i < sessions.length; i++) {
				var userSession = sessions[i];
				
				events.push(userSession.emitter.pushEvent('exitGroup', 
						{status: 'success', groupId: groupId}));
			}
			
			var data = {user: user, groupId: groupId,
					messageType: chatManager.messageType.leftGroup,
					content: '', importance: 0, location: null, 
					mustBeMember: false, db: this.db};
			
			// add member exited message if group is not removed
			if (!this.data.removed) {
				chatManager.addMessage(data, callback);
			} else {
				return callback(null, null);
			}
		}
	],
	function(err, message) {
		if (err) {
			lib.debug('failed to exit from group\r\n' + err);
			return callback(err);
		} else {
			return callback(null, message, events);
		}
	}, {db: this.data.db});
});

//when contact chat members changes, it's not contact chat anymore
//input: data.groupId
//output: contact
var invalidateContactGroup = dbManager.composablePattern(function(pattern, callback) {
	var groupId = this.data.groupId;
	
	pattern([
		function(callback) {			
			this.db.getContactByGroup({groupId: groupId, 
				lock: true}, callback);
		},
		function(result, fields, callback) {
			// if the group was for contact chat, it's not anymore
			if (result.length > 0) {
				var contact = result[0];
				this.data.contact = contact;
				
				// set group id null
				this.db.updateContactGroupChat({contactId: null,
					groupId: groupId}, 
					function(err, result, fields) {
						callback(err, true, result);
					});
			} else 
				callback(null, false, null);
		},
		// send any notifications
		// this must be sent before commit
		function(updated, result, callback) {
			// when no such contact group or contact id for group is already null,
			// affected rows is 0
			if (updated && result.affectedRows == 0)
				return callback(new Error('failed to update contact info'));
			
			callback(null);
		}
	],
	function(err) {
		if (err) {
			callback(err);
		} else {
			callback(null, this.data.contact);
		}
	});
});


var emitContactChatRemoved = function(groupId, contact) {
	var events = [];
	
	if (contact == null)
		return events;
	
	// notify two users of the contact
	var sessions = session.getUserSessions({userId: contact.userId})
	var sessions2 = session.getUserSessions({userId: contact.userId2});
	
	for (var i = 0; i < sessions.length; i++) {
		var contactUser = sessions[i];
		var data = {status: 'success', 
				groupId: groupId, contactId: contact.contactId,
				userId: contact.userId2};
		
		events.push(contactUser.emitter.pushEvent('contactChatRemoved', data));
	}
	
	for (var i = 0; i < sessions2.length; i++) {
		var contactUser = sessions2[i];
		var data = {status: 'success', 
				groupId: groupId, contactId: contact.contactId,
				userId: contact.userId};
		
		events.push(contactUser.emitter.pushEvent('contactChatRemoved', data));
	}
	
	return events;
}
// create default group name
var getDefaultGroupName = function(members) {
	// create string of names 'a, b, c...'
	// at most 5 names are listed
	if (members.length == 0)
		return '';
	
	var name = members[0].nickname;
	
	for (var i = 1; i < members.length && i < 5; i++) {
		var member = members[i];
		
		if (name.length + member.nickname.length + 2 > 125) {
			// if member can't be fully listed, '...' is appended
			name += '...';
			break;
		}
		
		name += ', ' + member.nickname;
	}
	
	return name;
}

// refer to http://stackoverflow.com/questions/1181575/determine-whether-an-array-contains-a-value
var contains = function(needle) {
    // Per spec, the way to identify NaN is that it is not equal to itself
    var findNaN = needle !== needle;
    var indexOf;

    if(!findNaN && typeof Array.prototype.indexOf === 'function') {
        indexOf = Array.prototype.indexOf;
    } else {
        indexOf = function(needle) {
            var i = -1, index = -1;

            for(i = 0; i < this.length; i++) {
                var item = this[i];

                if((findNaN && item !== item) || item === needle) {
                    index = i;
                    break;
                }
            }

            return index;
        };
    }

    return indexOf.call(this, needle) > -1;
};

module.exports = {init: init,
		addGroupAndStartChat: addGroupAndStartChat,
		getGroupList: getGroupList,
		addGroup: addGroup,
		addMembers: addMembers,
		exitGroup: exitGroup,};

var session = require('./session');
var chatManager = require('./chatManager');
var lib = require('./lib');
var async = require('async');