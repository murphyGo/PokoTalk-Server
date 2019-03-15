//gets result of getUserByEmail, or getUserById and
//returns object of data only available to other users
var filterUserData = function(user) {
	if (!user)
		return null;
	
	var lastSeen = dateToEpoch(user.lastSeen);
	
	return {userId: user.userId || user.id, email: user.email, 
		nickname: user.nickname, picture: user.picture,
		lastSeen: lastSeen, login: user.login, invited: user.invited};
};

// data of multiple users
var filterUsersData = function(users) {
	var result = [];
	
	var contains = function(user) {
		for (var i = 0; i < result.length; i++) {
			if (result[i].userId == user.userId)
				return true;
		}
		
		return false;
	};
	
	for (var i = 0; i < users.length; i++) {
		if (users[i])
			result.push(filterUserData(users[i]));
	}
	
	return result;
};

var filterGroupData = function(group) {
	return {groupId: group.groupId, name: group.name, 
		nbNewMessages: group.nbNewMessages, 
		lastMessage: group.lastMessage,
		alias: group.alias, 
		members: filterUsersData(group.members), 
		contactId: group.contactId || null, 
		eventId: group.eventId || null};
};

var filterMessageData = function(message) {
	var date = dateToEpoch(message.date);
	return {groupId: message.groupId, messageId: message.messageId,
		userId: message.userId, messageType: message.messageType, 
		nbread: message.nbread, date: date, importance: message.importance,
		content: message.content, location: message.location};
};

//data of multiple messages.
var filterMessagesData = function(messages) {
	var result = [];
	
	for (var i = 0; i < messages.length; i++) {
		result.push(filterMessageData(messages[i]));
	}
	
	return result;
};

var filterEventData = function(event) {
	var acked = event.acked ? event.acked.readUIntLE(0, 1) : null; 
	var started = event.started.readUIntLE(0, 1);
	
	return {eventId: event.eventId, name: event.name, description: event.description,  
		nbParticipants: event.nbParticipants, started: started,
		date: event.date, creater: filterUserData(event.creater), 
		participants: filterUsersData(event.participants), 
		localization: filterLocalizationData(event.localization), 
		groupId: event.groupId || null, acked: acked};
};

var filterEventsData = function(events) {
	var result = [];
	
	var contains = function(event) {
		for (var i = 0; i < result.length; i++) {
			if (result[i].eventId == event.eventId)
				return true;
		}
		
		return false;
	};
	
	for (var i = 0; i < events.length; i++) {
		if (events[i] && !contains(events[i]))
			result.push(filterEventData(events[i]));
	}
	
	return result;
}

var filterLocalizationData = function(localization) {
	if (!localization)
		return null;
	
	return {location: localization.location, date: localization.date};
};

var dateToEpoch = function(date) {
	if (date == null) {
		return null;
	}
	date = typeof date == 'object' ? date.getTime() : date;
	date = typeof date == 'number' ? date : null;
	return date;
};

var isArray = function(array) {
	if (array && typeof array == 'object' && array.hasOwnProperty('length'))
		return true;
	
	return false;
};

var isDate = function(date) {
	if (date && date instanceof Date && typeof date.getTime === 'function')
		return true;
	
	return false;
};

var containsUser = function(user, array) {
	if (!user)
		return false;
	
	for (var member in array) {
		if (member && member.userId == user.userId)
			return true;
	}
	
	return false;
};

var callbackRecursionProto = {
	i: 0,
	data: null,
	userCallback: null,
	callback: function(err) {
		if (err) {
			if (this.userCallback)
				this.userCallback(err, this.data);
		} else {
			this.i++;
			this.wrapFunc();
		}
	},
	appliedCallback: null,
	wrapFunc: function() {
		if (!this.cond(this.i)) {
			return this.userCallback(null, this.data);
		}
		
		this.main(this.i, this.appliedCallback);
	},
	start: function() {
		this.wrapFunc();
	},
	main: null,
	cond: null
};

var recursionConstructor = function(main, cond, callback) {
	this.data = {};
	this.userCallback = callback || function() {};
	this.main = main;
	this.cond = cond;
	var obj = this;
	this.appliedCallback = function() {
		obj.callback.apply(obj, arguments);
	};
};

recursionConstructor.prototype = callbackRecursionProto;

var recursion = function(cond, main, callback) {
	new recursionConstructor(main, cond, callback).start();
};

var debug = function(message) {
	if (process.env.DEBUG)
		console.log(message);
}

var parseLastMessageId = function(messageId) {
	return parseInt(messageId) + 1 || 1;
}

module.exports = {filterUserData: filterUserData,
		filterUsersData: filterUsersData,
		filterGroupData: filterGroupData,
		filterMessageData: filterMessageData,
		filterMessagesData: filterMessagesData,
		filterEventData: filterEventData,
		filterEventsData: filterEventsData,
		filterLocalizationData: filterLocalizationData,
		isArray: isArray,
		isDate: isDate,
		containsUser: containsUser,
		recursion: recursion,
		debug: debug,
		parseLastMessageId: parseLastMessageId};

if (require.main == module) {
	
	// test recursion
	var lib = require('./lib');
	r = lib.recursion(
	// condition
	function(i) {
		console.log(this.data);
		return i < 11;
	},
	// main body
	function(i, callback) {
		
		console.log(this.data);
		console.log(i);
		
		this.data.a = 1;
		
		if (i < 10)
			callback(null);
		else
			callback(new Error('error'));
	},
	// callback
	function(err, data) {
		console.log('end');
		console.log(err);
		console.log(data);
	});
	
}