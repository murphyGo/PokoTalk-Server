const rbTree = require('./RBTree');

// Location share rooms
const rooms = rbTree.createRBTree();

const init = function(user) {
	// Location share rooms for the user
	user.locationShareRooms = [];

	user.on('joinRealtimeLocationShare', function(data) {
		if (!session.validateRequest('joinRealtimeLocationShare', user, true, data))
			return;
		
		// Get user inputs
		var eventId = parseInt(data.eventId);
		var number = parseInt(data.number);
		var sendId = parseInt(data.sendId);

		// Check validity of inputs
		if (eventId !== eventId) {
			return;
		}
		
		// Set data null if it is NaN
		sendId = sendId !== sendId ? null : sendId;
		number = number !== number ? null : number;
		
		lib.debug('user ' + user.email + ' join location share in event ' + eventId);
		
		dbManager.trxPattern([
			function(callback) {
				// Check if the user is member of the event
				this.db.getEventParticipantByUser(
						{eventId: eventId, userId: user.userId}, callback);
			},
			function(result, fields, callback) {
				if (result.affectedRows == 0) {
					// No member row for the user
					return callback(new Error('You are not a participant of event'));
				}
				
				// Get room 
				let room = rooms.get(eventId);
				
				if (!room) {
					// Create room
					room = new LocationShareRoom(eventId);
					
					// Add room to rooms
					rooms.add(eventId, room);
					
					this.data.room = room;
					
					// It is first time to make room so get event localization data
					this.db.getEventLocalization({eventId: eventId}, callback);
				} else {
					this.data.room = room;
					
					// Location data is loaded at first, so just start callback
					callback(null, null, null);
				}
			},
			function(result, fields, callback) {
				let room = this.data.room;
				
				if (result && result.length > 0) {
					// Get location data
					let location = result[0];
					
					// Put location
					let locationName = location.title;
					let description = location.description;
					let lat = location.latitude;
					let lng = location.longitude;
					
					// Put localization data
					room.putMeetingLocation(locationName, description, lat, lng);
				}
				
				callback(null);
			}
		], function(err) {
			let room = this.data.room;
			
			if (err) {
				// Remove empty room if exists
				if (room && room.isEmpty()) {
					rooms.remove(eventId);
				}
				
				user.emit('joinRealtimeLocationShare', 
						{status: 'fail', errorMsg: 'you are not a member', 
							eventId: eventId, sendId: sendId});
			} else {
				// Add user to room
				let entry = room.joinMember(user, number);
				
				if (!entry) {
					// Already joined
					return user.emit('joinRealtimeLocationShare', 
							{status: 'fail', errorMsg: 'already joined', 
								eventId: eventId, sendId: sendId});
				}
				
				// Add room to user
				user.locationShareRooms.push(room);
				
				// Get localization
				let location = room.getMeetingLocation();
				
				// Start to broadcast
				room.startBroadcast();
				
				// Send message to user
				user.emitter.pushEvent('joinRealtimeLocationShare', 
						{status: 'success', eventId: eventId, sendId: sendId,
							location: location, number: entry.number}).fireEvent();
			}
		});
	});
	
	user.on('exitRealtimeLocationShare', function(data) {
		if (!session.validateRequest('exitRealtimeLocationShare', user, true, data))
			return;
		
		// Get user inputs
		var eventId = parseInt(data.eventId);
		var sendId = parseInt(data.sendId);

		// Check validity of inputs
		if (eventId !== eventId) {
			return;
		}
		
		// Set send id null if it is NaN
		sendId = sendId !== sendId ? null : sendId;
		
		lib.debug('user ' + user.email + ' exit location share in event ' + eventId);
		
		// Get room 
		let room = rooms.get(eventId);
		
		if (!room) {
			return user.emit('exitRealtimeLocationShare', 
					{status: 'fail', errorMsg: 'you has not joined', eventId: eventId, sendId: sendId});
		}
		
		// User exits from room
		room.exitMember(user);
		
		// Remove room from user
		let roomIndex = user.locationShareRooms.indexOf(room);
		
		if (roomIndex >= 0) {
			user.locationShareRooms.splice(roomIndex, 1);
		}
		
		// Check if the room is empty
		if (room.isEmpty()) {
			// Remove room from rooms
			rooms.remove(eventId);
		}
		
		// Send message to user
		user.emitter.pushEvent('exitRealtimeLocationShare', 
				{status: 'success', eventId: eventId, sendId: sendId}).fireEvent();
	});
	
	user.on('updateRealtimeLocation', function(data) {
		if (!session.validateRequest('updateRealtimeLocation', user, true, data))
			return;
		
		// Get user inputs
		var eventId = parseInt(data.eventId);
		var lat = parseFloat(data.lat);
		var lng = parseFloat(data.lng);
		var sendId = parseInt(data.sendId);

		// Check validity of inputs
		if (eventId !== eventId || lat !== lat || lng !== lng) {
			return;
		}
		
		// Set send id null if it is NaN
		sendId = sendId !== sendId ? null : sendId;
		
		lib.debug('user ' + user.email + ' update location share in event ' + eventId);
		
		// Get room 
		let room = rooms.get(eventId);
		
		if (!room) {
			return user.emit('updateRealtimeLocation', 
					{status: 'fail', errorMsg: 'you has not joined', eventId: eventId, sendId: sendId});
		}
		
		// Update user data
		if (room.updateLocation(user, lat, lng)) {
			// Send message to user
			user.emitter.pushEvent('updateRealtimeLocation', 
					{status: 'success', eventId: eventId, sendId: sendId}).fireEvent();
		} else {
			user.emit('updateRealtimeLocation', 
					{status: 'fail', errorMsg: 'failed to update', eventId: eventId, sendId: sendId});
		}
	});
}

const close = function(user) {
	if (!user.locationShareRooms) {
		return;
	}
	
	// Leave all rooms for the user
	for (var i in user.locationShareRooms) {
		let room = user.locationShareRooms[i]
		
		if (room) {
			// User exit from the room
			room.exitMember(user);
		}
	}
	
	// Remove list
	user.locationShareRooms = undefined;
};

const locationShareRoomProto = {
	roomId: null,
	members: null,
	meetingLocation: null,
	broadcastInterval: 1000,
	startBroadcast: function() {
		let room = this;
		
		if (!this.broadcastTimer) {
			this.broadcastTimer = setTimeout(function() {
				// Broadcast
				room._broadcast();
				
				// Remove timer
				room.broadcastTimer = undefined;
				
				// Arrange next broadcasts
				room.startBroadcast();
			}, this.broadcastInterval);
		}
	},
	broadcastTimer: null,
	_broadcast: function() {
		let sendData = {status: 'success', id: this.roomId, locations: [], timestamp: new Date().getTime()};
		let allMember = [];
		
		for (var key in this.members) {
			if (this.members.hasOwnProperty(key)) {
				var entries = this.members[key];
				
				if (entries) {
					entries.forEachEntry(function(entry) {
						// Parse entry data
						let user = entry.user;
						let number = entry.number;
						let lat = entry.lat;
						let lng = entry.lng;
						let timestamp = entry.timestamp;
						
						if (timestamp) {
							// Make data for the user
							let userData = {user: lib.filterUserData(user), 
									number: number, lat: lat, lng: lng, timestamp: timestamp};
							
							// Push the data to location list
							sendData.locations.push(userData);
						}
						
						// Add user data to members
						allMember.push(user);
					});
				}
			}
		}
		
		// Broadcast data to all member of this room
		for (var i in allMember) {
			let member = allMember[i];
			
			// Send data to the user
			member.emitter.pushEvent('realtimeLocationShareBroadcast', sendData).fireEvent();
		}
	},
	joinMember: function(member, number) {
		var memberId = parseInt(member.userId);
		
		if (memberId !== memberId) {
			return;
		}
		
		// Get entries for the user
		var userEntries = this.members[memberId];
		
		if (!userEntries) {
			// Create entries for the user
			userEntries = new UserEntries(memberId);
			
			this.members[memberId] = userEntries;
		}
		
		// Add the user to entries
		return userEntries.addEntry(member, number);
	},
	exitMember: function(member) {
		var memberId = parseInt(member.userId);
		
		if (memberId !== memberId) {
			return;
		}
		
		// Get user entries
		var userEntries = this.members[memberId];
		
		if (userEntries) {
			// Remove user entry
			userEntries.removeEntry(member);
			
			// Check if entries are empty
			if (userEntries.isEmpty()) {
				// Remove the entries
				this.members[memberId] = undefined;
			}
		}
	},
	updateLocation: function(member, lat, lng) {
		var memberId = parseInt(member.userId);
		
		if (memberId !== memberId) {
			return false;
		}
		
		// Get entries for the member
		let entries = this.members[memberId];
		
		if (entries) {
			// Update member location
			return entries.updateLocation(member, lat, lng);
		} else {
			return false;
		}
	},
	isEmpty: function() {
		for (var key in this.members) {
			if (this.members.hasOwnProperty(key)) {
				return false;
			}
		}
		
		return true;
	},
	putMeetingLocation: function(locationName, description, lat, lng) {
		this.meetingLocation = {locationName: locationName, description: description, 
				lat: lat, lng: lng};
	},
	getMeetingLocation: function() {
		return this.meetingLocation;
	}
};

const LocationShareRoom = function(roomId) {
	this.members = {}; 
	
	this.roomId = roomId;
};

const userEntriesProto = {
	userId: null,
	entries: null,
	findEntry: function(user) {
		for (var i in this.entries) {
			var entry = this.entries[i];
			
			if (entry.user == user) {
				return entry;
			}
		}
		
		return null;
	},
	addEntry: function(user, number) {
		var exist = this.findEntry(user);
		
		if (exist) {
			return null;
		}
		
		var entry = null;
		
		if (number) {
			// Search user entry for the number
			for (var i in this.entries) {
				var e = this.entries[i];
				
				if (e.user && e.number == number 
						&& e.user.userId == user.userId) {
					// Found entry
					entry = e;
					
					// Change user object
					entry.user = user;
				}
			}
		}
		
		if (!entry) {
			// Create new entry
			entry = {user: user, number: this.entries.length + 1,
					lat: null, lng: null, timestamp: null};
			
			// Push entry to user entries
			this.entries.push(entry);
		}
		
		return entry;
	},
	removeEntry(user) {
		// Find user entry
		var exist = this.findEntry(user);
		
		if (exist) {
			// Get index of entry
			let index = this.entries.indexOf(exist);
			
			if (index >= 0) {
				// Remove enrtry
				this.entries.splice(index, 1);
			}
		}
	},
	forEachEntry: function(callback) {
		this.entries.forEach(function(entry, index) {
			callback(entry);
		});
	},
	updateLocation: function(user, lat, lng) {
		// Get entry for the user
		var entry = this.findEntry(user);
		
		// Parse latitude and longitude
		var lat = parseFloat(lat);
		var lng = parseFloat(lng);
		
		if (lat !== lat || lng !== lng) {
			return false;
		}
		
		// Update location and renew timestamp
		if (entry) {
			entry.lat = lat;
			entry.lng = lng;
			entry.timestamp = new Date().getTime();
			return true;
		} else {
			return false;
		}
	},
	isEmpty: function() {
		return this.entries.length == 0;
	}
};

const UserEntries = function(userId) {
	this.userId = userId;
	
	this.entries = [];
}


// Set prototypes of constructors
LocationShareRoom.prototype = locationShareRoomProto;
UserEntries.prototype = userEntriesProto;

module.exports = {
	init: init,
	close: close,
};

const session = require('./session');
const dbManager = require('./dbManager');
const lib = require('./lib');