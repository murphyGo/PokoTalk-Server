/**
 * Chat manager
 * user can join or exit contact chat, group chat
 */
var rbTree = require('./RBTree');
var dbManager = require('./dbManager');

// set of active chats
var allChatRoom = rbTree.createRBTree();

var messageType = {
		textMessage: 0,
		joinGroup: 1,
		leftGroup: 2,
		image: 3,
		fileShare: 4
};

/* User operations
 * name               arguments
 * joinContactChat    email(of contact)
 * readMessage        groupId
 * sendMessage        groupId, content, importance, location
 */
var init = function(user) {
	user.on('joinContactChat', function(data) {
		if (!session.validateRequest('joinContactChat', user, true, data))
			return;
		
		var peerEmail = data.email;

		dbManager.trxPattern([
			function(callback) {
				this.db.getUserByEmail({email: peerEmail, lock: true},
						callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('no such user'));

				var contactId = result[0].userId;
				this.data.contactId = contactId;

				this.db.getAcceptedContact({userId: user.userId,
					userId2: contactId, lock: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('No such contact found'));

				var contact = result[0];
				var db = this.db;
				var data = this.data;
				this.data.contact = contact;

				// groupId cannot be 0
				if (contact.groupId) {
					// group already exists
					async.waterfall([
						function(callback) {
							db.getGroupOfUserById({groupId: contact.groupId,
								userId: user.userId, lock: true}, callback);
						},
						function(result, fields, callback) {
							if (result.length == 0)
								return callback(new Error('failed to get group chat'));

							var group = result[0];
							data.group = group;

							db.getGroupMembers({groupId: group.groupId, lock: true},
									callback);
						},
						function(result, field, callback) {
							var group = data.group;

							group.members = lib.filterUsersData(result);
							data.resMembers = [user];

							callback(null);
						}
					],
					function(err) {
						callback(err);
					});

				} else {
					// create new group for contact
					async.waterfall([
						function(callback) {
							group.addGroupAndStartChat({user: user, members: [contact.email],
								trx: false, db: db}, callback);
						},
						function(group, sessions, callback) {
							data.group = group;

							db.updateContactGroupChat({contactId: contact.contactId,
								groupId: group.groupId}, callback);
						},
						function(result, fields, callback) {
							if (result.affectedRows == 0)
								return callback(new Error('failed to update contact'));

							// update contactId
							data.group.contactId = contact.contactId;
							data.resMembers = data.group.members;

							callback(null);
						}
					],
					function(err) {
						callback(err);
					});
				}
			},
			function(callback) {
				var group = this.data.group;
				//var sessions = session.getUsersSessions(this.data.resMembers);
				
				// For poor client, only notify request user
				var contact = this.data.contact;
				
				// let user know the new group for contact
				emitJoinContactChat(group, user, contact);

				callback(null);
			}
		],
		function(err) {
			if (err) {
				console.log(err);
				user.emit('joinContactChat', {status: 'fail', errorMsg: 'server error'});
			}
		});
	});

	user.on('readMessage', function(data) {
		if (!session.validateRequest('readMessage', user, true, data))
			return;

		var groupId = data.groupId;
		var nbMessageMax = data.nbMessageMax || 100;
		nbMessageMax = nbMessageMax > 100 ? 100 : nbMessageMax;
		var startMessageId = data.startMessageId;
		startMessageId = startMessageId >= 0 ? startMessageId : 0;

		dbManager.trxPattern([
			function(callback) {
				// check if the user is member of the group
				this.db.getGroupMemberByUser({groupId: groupId, userId: user.userId,
					lock: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('You are not member of the group'));

				// get at most 100 messages
				this.db.getMessagesFromId({groupId: groupId, userId: user.userId, 
					startMessageId: startMessageId, nbMessages: nbMessageMax, lock: true}, callback);
			}
		],
		function(err, result) {
			if (err) {
				user.emit('readMessage', {status: 'fail', errorMsg: 'server error'});
			} else {
				user.emit('readMessage', {status: 'success', groupId: groupId, 
					messages: lib.filterMessagesData(result)});
			}
		});
	});
	
	user.on('readRecentMessage', function(data) {
		if (!session.validateRequest('readRecentMessage', user, true, data))
			return;

		var groupId = data.groupId;
		var nbMessageMax = data.nbMessageMax || 100;
		nbMessageMax = nbMessageMax > 100 ? 100 : nbMessageMax;

		dbManager.trxPattern([
			function(callback) {
				// check if the user is member of the group
				this.db.getGroupMemberByUser({groupId: groupId, userId: user.userId,
					lock: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('You are not member of the group'));

				// get at most 100 messages
				this.db.getRecentMessages({groupId: groupId, userId: user.userId,
					nbMessages: nbMessageMax, lock: true}, callback);
			}
		],
		function(err, result) {
			if (err) {
				user.emit('readRecentMessage', {status: 'fail', errorMsg: 'server error'});
			} else {
				user.emit('readRecentMessage', {status: 'success', groupId: groupId, 
					messages: lib.filterMessagesData(result)});
			}
		});
	});

	user.on('readNbreadOfMessages', function(data) {
		if (!session.validateRequest('readNbreadOfMessages', user, true, data))
			return;

		var groupId = data.groupId;
		var startId = data.startMessageId;
		var endId = data.endMessageId;
		startId = startId >= 0 ? startId : 0;
		endId = endId >= 0 ? endId : 0;

		dbManager.trxPattern([
			function(callback) {
				// check if the user is member of the group
				this.db.getGroupMemberByUser({groupId: groupId, userId: user.userId,
					lock: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('You are not member of the group'));

				// TODO: limit maximum message numbers
				this.db.getNbreadOfMessages({groupId: groupId, userId: user.userId,
					startMessageId: startId, endMessageId: endId, lock: true}, callback);
			}
		],
		function(err, result) {
			if (err) {
				user.emit('readNbreadOfMessages', {status: 'fail', errorMsg: 'server error'});
			} else {
				user.emit('readNbreadOfMessages', {status: 'success', groupId: groupId, messages: result});
			}
		});
	});
	
	user.on('sendMessage', function(data) {
		if (!session.validateRequest('sendMessage', user, true, data))
			return;
		
		var groupId = parseInt(data.groupId);
		var sendId = data.sendId;
		var content = data.content || '';
		var importance = data.importance || 0;
		var location = data.location || null;
	
		if (groupId !== groupId)
			return;

		dbManager.trxPattern([
			function(callback) {
				// get group member count
				sendMessage({sendId: sendId, groupId: groupId, user: user, messageType: messageType.textMessage,
					content: content, importance: importance, location: location, db: this.db}, 
					callback);
			}
		],
		function(err) {
			if (err) {
				console.log('failed to save message\r\n' + err);
			}
		});
	});

	// TODO: solve deadlock problem
	// user have read messages id from data.ackStart to ackEnd inclusive
	user.on('ackMessage', function(data) {
		if (!session.validateRequest('ackMessage', user, true, data))
			return;

		var groupId = data.groupId;
		var ackStart = parseInt(data.ackStart);
		var ackEnd = parseInt(data.ackEnd);
		
		// check NaN, +-Infinity
		if (!isFinite(ackStart) || !isFinite(ackEnd))
			return;

		if (ackStart > ackEnd)
			return;
		
		console.log('groupId ' + groupId + ' ack ' + ackStart + ' ~ ' + ackEnd);
		
		dbManager.trxPattern([
			function(callback) {
				// check if the user is member of the group
				this.db.getGroupMemberByUser({groupId: groupId, userId: user.userId,
					update: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('You are not a member of group or no such group'));
				
				this.data.userAckStart = result[0].ackStart;
				
				if (this.data.userAckStart > ackStart) {
					ackStart = this.data.userAckStart;
				}
				
				if (ackStart > ackEnd) {
					return callback(new Error('Your ack range is invalid'));
				}

				this.db.getConflictingAcks({groupId: groupId, userId: user.userId,
					ackStart: ackStart, ackEnd: ackEnd, update: true}, callback);
			},
			function(result, fields, callback) {
				var ack, ack2;
				var newAcks = [];
				ack = result[0];
				ack2 = result.length > 1 ? result[result.length - 1] : ack;

				// check if already acked
				if (ack && ack.ackStart <= ackStart &&
						ack.ackEnd >= ackEnd) {
					var error = new Error('Already acked');
					error.alreadyAcked = true;
					return callback(error);
				}

				var mergedAckStart = ackStart;
				var mergedAckEnd = ackEnd;

				if (ack) {
					if (ack.ackStart <= ackStart) {
						mergedAckStart = ack.ackStart;
					} else {
						newAcks.push({ackStart: ackStart, ackEnd: ack.ackStart - 1});
					}

					var curAckStart = ack.ackEnd + 1;
					var curAckEnd;

					for (var i = 1; i < result.length; i++) {
						var ack = result[i];

						if (ack.ackStart <= curAckStart) {
							curAckStart = ack.ackEnd + 1;
							continue;
						}

						curAckEnd = ack.ackStart - 1;

						if (curAckStart <= curAckEnd)
							newAcks.push({ackStart: curAckStart, ackEnd: curAckEnd});

						curAckStart = ack.ackEnd + 1;
					}

					if (ack2.ackEnd >= ackEnd) {
						mergedAckEnd = ack2.ackEnd;
					} else {
						newAcks.push({ackStart: ack2.ackEnd + 1, ackEnd: ackEnd});
					}
				} else {
					// no conflicts, just add
					newAcks.push({ackStart: ackStart, ackEnd: ackEnd});
				}

				console.log(newAcks);

				this.data.mergedAckStart = mergedAckStart;
				this.data.mergedAckEnd = mergedAckEnd;
				this.data.newAcks = newAcks;
				
				console.log('merged ' + this.data.mergedAckStart + ' ~ ' + this.data.mergedAckEnd);
				
				if (this.data.mergedAckStart > this.data.mergedAckEnd) {
					return callback(new Error('merged ack end is greater than merged ack start'));
				}

				// remove every conflicting acks
				this.db.removeConflictingAcks({groupId: groupId, userId: user.userId,
					ackStart: ackStart, ackEnd: ackEnd}, callback);
			},
			function(result, fields, callback) {
				// Ack start must be >= than user's first ack start number
				var mergedAckStart = this.data.mergedAckStart;
				var mergedAckEnd = this.data.mergedAckEnd;

				// store new ack
				this.db.addMessageAck({groupId: groupId, userId: user.userId,
					ackStart: mergedAckStart, ackEnd: mergedAckEnd}, callback);
			},
			function(result, fields, callback) {
				var acks = this.data.newAcks;
				var db = this.db;
				
				lib.recursion(function(i) {
					return i < acks.length;
				},
				function(i, callback) {
					var ack = acks[i];
					var ackStart = ack.ackStart;
					console.log('ack Start ' + ackStart);
					var ackEnd = ack.ackEnd;
					
					async.waterfall([
						function(callback) {
							db.decrementMessageNbread({groupId: groupId, userId: user.userId,
								ackStart: ackStart, ackEnd: ackEnd}, callback);
						},
						function(result, fields, callback) {
							db.getNbOthersMessagesInRange({groupId: groupId, userId: user.userId,
								startId: ackStart, endId: ackEnd, update: true}, callback);
						},
						function(result, fields, callback) {
							if (result.length != 1)
								return callback(new Error('Failed to count message'));
							
							var nbNewMessages = result[0].nbNewMessages;
							db.subtractNbNewMessagesOthers({groupId: groupId, userId: user.userId,
								nbNewMessages: nbNewMessages}, callback);
						}
					],
					callback);
				},
				callback);
			},
			function(data, callback) {
				var acks = this.data.newAcks;
				
				// notify ack to all other members
				notifyAcks({groupId: groupId, user: user, acks: acks}, callback);
			}
		],
		function(err) {
			if (err) {
				lib.debug('Ack error : ' + err.message);
				if (!err.alreadyAcked) {
					user.emit('ackMessage', {status: 'fail', errorMsg: 'failed to update ack'});
				} else {
					user.emit('ackMessage', {status: 'fail', errorMsg: 'you already acked'});
				}
			} else {
				// ackMessage just notify the session that ack is completed from ackStart to ackEnd.
				// This does not mean the user must decrement nbNotReadUser of messages with
				// messageId from ackStart to ackEnd. This message just notifies that the session
				// don't have to ack message id in this range again.
				// NOTE: User must decrement nbNotReadUser for messageAck event.
				user.emit('ackMessage', {status: 'success', groupId: groupId, 
					ackStart: ackStart, ackEnd: ackEnd});
			}
		});
	});

	user.on('joinChat', function(data) {
		if (!session.validateRequest('joinChat', user, true, data))
			return;

		var groupId = data.groupId;

		dbManager.trxPattern([
			function(callback) {
				this.db.getGroupMemberByUser({groupId: groupId, userId: user.userId,
					lock: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('You are not member of group or' +
					' no such group'));

				// join chat room
				chatRoom.join({users: [user]}, callback);
			}
		],
		function(err, errSessions) {
			if (err || errSessions) {
				user.emit('joinChat', {status: 'fail',
					errorMsg: 'failed to join chat, if you are a member, please retry'});
			} else {
				user.emit('joinChat', {status: 'success'});
			}
		});
	});

	user.on('leaveChat', function(data) {
		if (!session.validateRequest('leaveChat', user, true, data))
			return;

		var groupId = data.groupId;

		dbManager.trxPattern([
			function(callback) {
				this.db.getGroupMemberByUser({groupId: groupId, userId: user.userId,
					lock: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('You are not member of group or' +
					' no such group'));

				// join chat room
				chatRoom.leave({users: [user]}, callback);
			}
		],
		function(err, errSessions) {
			if (err || errSessions) {
				user.emit('leaveChat', {status: 'fail',
					errorMsg: 'failed to leave chat, if you are a member, please retry'});
			} else {
				user.emit('leaveChat', {status: 'success'});
			}
		});
	});
	//how to send location when we get it, we send it back to all the chatroom
	//user.on("shareLocation",function(data){
		//user.emit("getLocation",data);
	//});
	
	user.on('getMemberJoinHistory', function(data) {
		if (!session.validateRequest('getMemberJoinHistory', user, true, data))
			return;

		var groupId = data.groupId;
		var messageId = data.messageId;

		dbManager.trxPattern([
			function(callback) {
				this.db.getMemberJoinHistory({groupId: groupId, messageId: messageId,
					lock: true}, callback);
			}
		],
		function(err, result) {
			if (err) {
				user.emit('getMemberJoinHistory', {status: 'fail',
					errorMsg: 'failed to get member join history'});
			} else {
				var members = lib.filterUsersData(result);
				var msg = {status: 'success', groupId: groupId, messageId: messageId,
						members: members};
				
				user.emit('getMemberJoinHistory', msg);
			}
		});
	});
};

// init user when logined
var initUser = dbManager.composablePattern(function(pattern, callback) {
	var user = this.data.user;
	user.chatRooms = [];

	// when logined, user will automatically join all chatRooms
	pattern([
		function(callback) {
			group.getGroupList({user: user, db: this.db}, callback);
		},
		function(groups, callback) {
			var db = this.db;

			this.data.groupList = groups;

			var joinGroupIter = function(i) {
				var group = groups[i];

				if (i == groups.length)
					return callback(null);

				async.waterfall([
					function(callback) {
						joinGroupChat({users: [user], groupId: group.groupId,
							db: db}, callback);
					}
				],
				function(err, errSessions) {
					if (err) {
						console.log('failed to join chat' + err);
						throw err;
					} else {
						if (errSessions) {
							chatTryer.pushSessions(group.groupId, errSessions, true);
						}

						joinGroupIter(i + 1);
					}
				});
			};

			joinGroupIter(0);
		},
	],
	function(err) {
		if (err) {
			// can't fail currently
			console.log('failed to join chat'+ err);

			callback(err);
		} else {
			callback(null);
		}
	}, {db: this.data.db});
});


// TODO: max(messageId) + 1 is not alway true, because when user exits
//       messages of the users are removed -> let messages stay even if the user who sent the messgage has left
// store message in database and broadcast to all other users
var sendMessage = dbManager.composablePattern(function(pattern, callback) {
	var user = this.data.user;
	var groupId = parseInt(this.data.groupId);
	var messageType = this.data.messageType;
	var content = this.data.content || '';
	var importance = this.data.importance || 0;
	var location = this.data.location || null;
	var date = new Date();
	var joinMemberUserIds = this.data.joinMemberUserIds || null;
	var toMe = this.data.toMe;
	
	// client defined id for the message
	// used for identifying message sent feedback
	var sendId = parseInt(this.data.sendId);
	
	if (groupId !== groupId)
		return callback(new Error("failed to parse groupId"));

	pattern([
		function(callback) {
			// get group member count
			this.db.getGroupMemberNumber({groupId: groupId, update: true}, callback)
		},
		function(result, fields, callback) {
			if (result.length == 0)
				return callback(new Error('failed to get group member count'));
			
			this.data.nbMembers = result[0].nbMembers;
			
			// check if the user is member of the group
			this.db.getGroupMemberByUser({groupId: groupId, userId: user.userId,
				update: true}, callback);
		},
		function(result, fields, callback) {
			if (result.length == 0)
				return callback(new Error('You are not member of the group'));
			
			this.db.getLastMessageIdByGroupId({groupId: groupId, update: true}, callback);
		},
		function(result, fields, callback) {
			if (result.length == 0)
				return callback(new Error('Failed to get message id'));
			
			var nbMembers = this.data.nbMembers;
			var messageId = parseInt(result[0].messageId) + 1 || 1;
			
			var data = {groupId: groupId, userId: user.userId, messageType: messageType,
					content: content, importance: importance, location: location, date: date, 
					nbread: nbMembers - 1, messageId: messageId};
			
			this.data.message = lib.filterMessageData(data);
			
			// save message in database
			this.db.addMessage(data, callback);
		},
		function(result, fields, callback) {
			if (result.affectedRows == 0)
				return callback(new Error('Failed to save in database'));
			
			//TODO: put this process into background so that send message processing completes quickly
			this.db.incrementNbNewMessagesOthers({groupId: groupId, userId: user.userId},
					callback);
		},
		function(result, fields, callback) {
			// get active chat
			var chatRoom = allChatRoom.get(groupId);

			if (!chatRoom)
				return callback(null);
			
			var data = this.data.message;
			data.user = user;
			data.toMe = toMe;
			
			// sendMessage is sent only when sendId exists
			if (sendId === sendId) {
				user.emit('sendMessage', {status: 'success', sendId: sendId, messageId: data.messageId, 
					date:data.date, nbread: this.data.nbMembers - 1, groupId: groupId});
			}
			
			// broadcast message
			// TODO: optimization -> cache messageId so set nbread on server 
			chatRoom.sendMessage(data, callback);
		}
	],
	function(err) {
		if (err) {
			console.log('failed to save message\r\n' + err);

			if (sendId === sendId) {
				user.emit('sendMessage', {status: 'fail', sendId: sendId, 
					errorMsg: 'failed to send message'});
			}
			
			callback(err);
		} else {
			callback(null, this.data.message);
		}
	});
});

// user enter group chat invited before
// it should be synchronous until user joins chat
// input : data.groupId, data.users
var joinGroupChat = function(data, callback) {
	var users = data.users;
	var groupId = data.groupId;

	// no member to join
	if (users.length == 0)
		return callback(null, null);

	chatTryer.removeSessions(groupId, users);

	async.waterfall([
		// get chat room. create if does not exist
		function(callback) {
			var chatRoom = allChatRoom.get(groupId);

			if (!chatRoom) {
				chatRoom = chat.createChatRoom({groupId: groupId});

				if (!allChatRoom.add(groupId, chatRoom))
					return callback(new Error('Failed to open chat'));
			}

			// every sessions of users will enter chat
			var sessions = session.getUsersSessions(users, true);

			// join chat room
			chatRoom.join({users: sessions}, callback);
		},
	],
	function(err, errSessions) {
		if (err) {
			callback(err);
		} else {
			callback(null, errSessions);
		}
	});
};

// when user leaves group
// it should be synchronous until user leaves chat
// input : data.groupId, data.users
var leaveGroupChat = function(data, callback) {
	var users = data.users;
	var groupId = data.groupId;

	// no member to join
	if (users.length == 0)
		return callback(null, null);

	chatTryer.removeSessions(groupId, users);

	var chatRoom;
	async.waterfall([
		// check if the user is group member
		function(callback) {
			var members;
			// get active chat
			chatRoom = allChatRoom.get(groupId);
			// no active chatRoom
			if (!chatRoom) {
				return callback(null, null);
			}
			
			members = chatRoom.onlineMembers;

			// every sessions of users will leave chat
			var sessions = session.getUsersSessions(users, true);

			chatRoom.leave({users: sessions}, callback);
		},
		function(errSessions, callback) {
			removeGroupChatIfEmpty(chatRoom);

			callback(null, errSessions);
		}
	],
	function(err, errSessions) {
		if (err) {
			callback(err);
		} else {
			callback(null, errSessions);
		}
	});
};

var notifyAcks = function(data, callback) {
	var user = data.user;
	var groupId = data.groupId;
	var acks = data.acks;

	async.waterfall([
		// check if the user is group member
		function(callback) {
			// get active chat
			var chatRoom = allChatRoom.get(groupId);

			// no active chatRoom
			if (!chatRoom) {
				return callback(null);
			}
			
			// sender will not get ack of itself
			var sessions = session.getUserSessions(user);
			
			var ackIter = function(i) {
				if (i == acks.length) {
					return callback(null);
				}
				
				var ack = acks[i];
				
				chatRoom.sendAck({user: user, users: [], 
					ackStart: ack.ackStart, ackEnd: ack.ackEnd},
					function(err) {
						if (err)
							callback(err);
						else
							ackIter(i + 1);
					});
			};

			ackIter(0);
		},
	],
	function(err) {
		if (err) {
			callback(err);
		} else {
			callback(null);
		}
	});
};

// TODO: Undo ack is deprecated
var undoAcks = function(data, callback) {
	var user = data.user;
	var groupId = data.groupId;
	var acks = data.acks;

	async.waterfall([
		// check if the user is group member
		function(callback) {
			// get active chat
			var chatRoom = allChatRoom.get(groupId);

			// no active chatRoom
			if (!chatRoom) {
				return callback(null);
			}

			chatRoom.undoAcks({acks: acks, user: user}, callback);
		},
	],
	function(err) {
		if (err) {
			callback(err);
		} else {
			callback(null);
		}
	});
};

//when user disconnects, exit from every chats
//input : data.user
var leaveAllGroupChat = function(data) {
	var user = data.user;
	var chatRooms = user.chatRooms;

	if (!user || !chatRooms)
		return;

	chatTryer.removeSessionForAll(user);

	for (var i in chatRooms) {
		var chatRoom = chatRooms[i];

		(function(chatRoom) {
			//NOTE: leave callback is asynchronously called
			chatRoom.leave({users: [user]}, function(err, errSessions) {
				if (errSessions) {
					chatTryer.pushSessions(groupId, errSessions, false);

					console.log('User exit and leaving chat failed, try again...');
				}

				removeGroupChatIfEmpty(chatRoom);
			});
		})(chatRoom);
	}

	console.log('exited every group');
};

//if no online members, remove chat
var removeGroupChatIfEmpty = function(chatRoom) {
	if (chatRoom.getMemberNum() == 0 &&
			!removeGroupChat(chatRoom))
		throw Error('chat room remove failed!');
};

// when number of online member in group is 0,
// remove group chat
var removeGroupChat = function(chatRoom) {
	console.log('remove group chat ' + chatRoom.groupId);
	if (!allChatRoom.remove(chatRoom.groupId))
		return false;

	return true;
};

var emitJoinContactChat = function(group, user, contact) {
	var sendMsg = lib.filterGroupData(group);
	
	var sessions = session.getUserSessions({userId: user.userId});

	// let user know the new group for contact
	for (var i = 0; i < sessions.length; i++) {
		var s = sessions[i];

		s.emit('joinContactChat', {status: 'success', 
			contactId: contact.contactId, group: sendMsg,
			userId: contact.userId});
	}
}

// background process trying to join or leave chat
var chatTryer = (function() {
	var requests = []; // remaining [groupId, session] to join

	// push one request
	var pushSession = function(groupId, session, isJoin) {
		var req = {groupId: groupId, session: session};
		var handle = setTimeout(function() {
				trySession(req, isJoin);
			},
			calcTimeToWait());

		req.handle = handle;
		requests.push(req);
	};

	// push multiple requests
	var pushSessions = function(groupId, sessions, isJoin) {
		sessions.forEach(function(session) {
			pushSession(groupId, session, isJoin);
		});
	};

	// cancel every request for session for a group
	var removeSession = function(groupId, session) {
		requests.forEach(function(req) {
			var session2 = req.session;
			var reqGroupId = req.groupId;
			var handle = req.handle;

			if (session.userId == session2.userId &&
					groupId == reqGroupId) {
				requests.splice(requests.indexOf(req), 1);
				clearTimeout(handle);
			}
		});
	};

	// cancel every request for sessions for a group
	var removeSessions = function(groupId, sessions) {
		sessions.forEach(function(session) {
			removeSession(groupId, session);
		});
	};

	// cancel every request for session for every group
	var removeSessionForAll = function(session) {
		requests.forEach(function(req) {
			var session2 = req.session;
			var handle = req.handle;

			if (session.userId == session2.userId) {
				requests.splice(requests.indexOf(req), 1);
				clearTimeout(handle);
			}
		});
	};

	// cancel every request for sessions for every group
	var removeSessionsForAll = function(sessions) {
		sessions.forEach(function(session) {
			removeSessionForAll(session);
		});
	};

	var trySession = function(req, isJoin) {
		var groupId = req.groupId;
		var session = req.session;

		// remove from list
		requests.splice(requests.indexOf(req), 1);

		async.waterfall([
			function(callback) {
				var arg = {groupId: groupId, users: [session]};

				if (isJoin)
					joinGroupChat(arg, callback);
				else
					leaveGroupChat(arg, callback);
			}
		],
		function(err, errSessions) {
			if (err || errSessions) {
				// try again
				pushSession(groupId, session, isJoin);
			}
		});
	};

	// calculate next try time in milisec
	var calcTimeToWait = function() {
		return (requests.length + 1) * 100;
	};

	return {pushSession: pushSession,
		pushSessions: pushSessions,
		removeSession: removeSession,
		removeSessions: removeSessions,
		removeSessionForAll: removeSessionForAll,
		removeSessionsForAll: removeSessionsForAll};
})();

module.exports = {init: init,
		messageType: messageType,
		initUser: initUser,
		joinGroupChat: joinGroupChat,
		sendMessage: sendMessage,
		leaveGroupChat: leaveGroupChat,
		leaveAllGroupChat: leaveAllGroupChat,
		notifyAcks: notifyAcks,
		undoAcks: undoAcks,
		chatTryer: chatTryer};


//Léo try to communicate with Android
/*server.on("askList",function(){
		server.emit("onGetList","blabla");
});*/
//end Android communication

var session = require('./session');
var group = require('./group');
var chat = require('./chat');
var lib = require('./lib');
var async = require('async');
