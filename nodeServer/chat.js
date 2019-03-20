/** 
 * Server based chat
 */

/* User operations
 * name               arguments
 * sendMessage        groupId, 
 */

/* User events 
 * name
 * newMessage
 * membersJoin
 * membersLeave
 * messageAck
 */

var init = function(user) {
};

var chatRoomProto = {
	groupId: undefined,
	
	// array of online users
	// users in here and joined users are same set 
	onlineMembers: null, 
	
	getRoomName: function() {
		return this.groupId.toString();
	},
	
	getMemberNum: function() {
		return this.onlineMembers.length; 
	},
	
	// returns list of user connections
	//console.log(server.io.sockets.adapter.rooms);
	//var room = server.io.sockets.adapter.rooms[this.getRoomName()];
	
	// user broadcasts message to other users
	// assumed the user is member of this group
	broadcast: function(user, name, message) {
		var sessions = this.onlineMembers;
		
		for (var i in sessions) {
			var session = sessions[i];
			if (session != user) {
				session.emit(name, message);
			}
		}
		//user.broadcast.to(this.getRoomName()).emit(name, message);
	},
	
	// broadcast every user in room
	broadcastAll: function(name, message) {
		var sessions = this.onlineMembers;
		
		for (var i in sessions) {
			sessions[i].emit(name, message);
		}
		
		//server.io.sockets.in(this.getRoomName()).emit(name, message);
	},
	
	// same as broadcast but filter user will get message by 'filter' function
	broadcastFilter: function(filter, name, message) {
		var sessions = this.onlineMembers;
		
		for (var i = 0; i < sessions.length; i++) {
			var session = sessions[i];
			
			if (filter(session))
				continue;
			
			session.emit(name, message);
		}
	},
	
	// broadcast message to member sessions
	sendMessage: function(data, callback) {
		var user = data.user;
		var messageId = data.messageId;
		var messageType = data.messageType;
		var nbread = data.nbread;
		var content = data.content || '';
		var importance = data.importance || 0;
		var location = data.location;
		var date = data.date;
		var toMe = data.toMe ? true : false;
		
		var message = {groupId: this.groupId, messageId: messageId, messageType: messageType,
				userId: user.userId, content: content, importance: importance,
				location: location, date: date, nbread: nbread};
		
		if (toMe) {
			// broadcast message to all sessions in chat including sender session
			this.broadcastAll('newMessage', {status: 'success', message: message});
		} else {
			// broadcast message to all other sessions in chat
			this.broadcast(user, 'newMessage', {status: 'success', message: message});
		}
		
		callback(null);
	},
	
	// send ack to all user except users
	sendAck: function(data, callback) {
		var users = data.users;
		var user = data.user;
		var ackStart = typeof data.ackStart == 'number' ? data.ackStart : null;
		var ackEnd = typeof data.ackEnd == 'number' ? data.ackEnd : null;
		
		var message = {groupId: this.groupId, userId: user.userId,
				ackStart: ackStart, ackEnd: ackEnd};
		
		// broadcast to other users' sessions
		this.broadcastFilter(function(user) {
			if (users.indexOf(user) >= 0)
				return true;
			
			return false;
		}, 'messageAck', {status: 'success', message: message});
		
		callback(null);
	},
	
	printMembers: function() {
		var members = this.onlineMembers;
		lib.debug('print group members');
		for (var i = 0; i < members.length; i++) {
			lib.debug('group' + this.groupId + ': (' + 
					members[i].userId + ') ' + members[i].email);
		}
	},
	
	// input: data.users
	// output: errSessions(if error, is list of sessions failed, otherwise null)
	join: function(data, callback) {
		var sessions = data.users;
		var chatRoom = this;
		var onlineMembers = this.onlineMembers;
		//var errSessions = [];
		
		var joinIter = function(i) {
			if (i == sessions.length) {
				// notify users
				chatRoom.broadcastFilter(function(user) {
					if (sessions.indexOf(user) >= 0)
						return true;
					
					return false;
				},
				'membersJoin', {status: 'success', groupId: chatRoom.groupId, 
					members: lib.filterUsersData(sessions)});
				
				//chatRoom.printMembers();
				
				return callback(null);
				
				/*if (errSessions.length == 0)
					return callback(null, null);
				//else
				//	return callback(null, errSessions);*/
			}
			
			var user = sessions[i];
			
			if (onlineMembers.indexOf(user) >= 0)
				return joinIter(i + 1);
			
			onlineMembers.push(user);
			joinIter(i + 1);
			
			/*
			user.join(chatRoom.getRoomName(), function(err) {
				if (err) {
					errSessions.push(user);
				} else {
					onlineMembers.push(user);
					user.chatRooms.push(chatRoom);
					
					joinIter(i + 1);
				}
			});*/
		};
		
		joinIter(0);
	},
	
	// input: data.users
	// output: errSessions(if error, is list of sessions failed, otherwise null)
	leave: function(data, callback) {
		var sessions = data.users;
		var chatRoom = this;
		var onlineMembers = this.onlineMembers;
		//var errSessions = [];
		
		var leaveIter = function(i) {
			if (i == sessions.length) {
				// notify users
				chatRoom.broadcastAll('membersLeave',
						{status: 'success', groupId: chatRoom.groupId, 
					members: lib.filterUsersData(sessions)});
				
				//chatRoom.printMembers();
				
				return callback(null);
				
				/*
				if (errSessions.length == 0)
					return callback(null, null);
				else
					return callback(null, errSessions);
					*/
			}
			
			var user = sessions[i];
			var memberIndex = onlineMembers.indexOf(user);
			
			if (memberIndex < 0)
				return leaveIter(i + 1);
			
			onlineMembers.splice(memberIndex, 1);
			leaveIter(i + 1);
			
			/*
			user.leave(chatRoom.getRoomName(), function(err) {
				if (err) {
					errSessions.push(user);
				} else {
					var memberIndex = onlineMembers.indexOf(user);
					var chatRoomIndex = user.chatRooms.indexOf(chatRoom);
					
					onlineMembers.splice(memberIndex, 1);
					user.chatRooms.splice(chatRoomIndex, 1)
					
					leaveIter(i + 1);
				}
			});*/
		};
		
		leaveIter(0);
	},
};

// chat room constructor
var chatRoom = function() {
	// constructor
	this.init = function(data) {
		this.groupId = data.groupId;
		this.onlineMembers = [];
		
		return this;
	}
};

chatRoom.prototype = chatRoomProto;

var createChatRoom = function (data) {
	return new chatRoom().init(data);
};

module.exports = {init: init,
		createChatRoom: createChatRoom};

var session = require('./session');
var dbManager = require('./dbManager');
var group = require('./group');
var server = require('./appServer');
var lib = require('./lib');
var async = require('async');