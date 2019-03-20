/**
 * Event management
 *
 * user can create event with event name, description, participants,
 * discussion date and optionally meeting time and location.
 * When time for event comes, group for event is created and
 * all participants will be notified that event has been started.
 * Then, event participants can have server chat and conference for the event.
 * A user can exit event. When a user exit event, the user will automatically
 * exit group dedicated to the event if group was created.
 */
var dbManager = require('./dbManager');
var nodemailer = require('nodemailer');

// TODO: Event deadlock, event -> participants order
function init(user) {
	// read every events of the user
	user.on('getEventList', function(data) {
		if (!session.validateRequest('getEventList', user, false))
			return;

		dbManager.trxPattern([
			function(callback) {
				getEventList({userId: user.userId, db: this.db}, callback);
			},
			function(eventList, callback) {
				var event = user.pushEvent('getEventList', {status: 'success', events: eventList});
				
				callback(null, event);
			}
		],
		function(err, event) {
			if (err) {
				if (event) {
					event.cancelEvent();
				}
				user.emit('getEventList', {status: 'fail', errorMsg: 'server error'});
			} else {
				event.fireEvent();
			}
		});
	});

	// create event with participants
	user.on('createEvent', function(data) {
		if (!session.validateRequest('createEvent', user, true, data))
			return;

		var emails = data.participants;
		var nbParticipantsMax = parseInt(data.nbParticipantsMax || 128);
		var name = data.name;
		var description = data.description;
		var date = data.date;
		var localization = data.localization;
		if (localization) {
			var location = localization.location;
			var ldate = localization.date;
		}
		
		// ParseInt returns NaN if it is not number
		date = parseInt(date);
		ldate = parseInt(ldate);
		
		// Check if NaN
		if (date !== date || ldate !== ldate)
			return;

		date = new Date(date);
		ldate = new Date(ldate);

		if (nbParticipantsMax !== nbParticipantsMax ||
				(localization && !location) ||
				(localization && isNaN(ldate.getTime())) ||
				!lib.isArray(emails) ||
				isNaN(date.getTime()) ||
				!name)
			return;

		if (date !== date || (localization && ldate !== ldate))
			return;

		// remove invalid emails
		emails = emails.filter(function(email) {return email;});

		dbManager.trxPattern([
			function(callback) {
				getParticipants({user: user, emails: emails,
					db: this.db}, callback);
			},
			function(participants, callback) {
				this.data.participants = participants;

				// add the user if not contained
				if (!lib.containsUser(user, participants))
					participants.push(lib.filterUserData(user));

				var event = {name: name, description: description, userId: user.userId,
						date: date, nbParticipantsMax: nbParticipantsMax};

				this.data.event = event;

				this.db.addEvent(event, callback);
			},
			function(result, fields, callback) {
				this.db.lastInsertId(callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('no last insert id'));

				var participants = this.data.participants;
				var eventId = result[0].lastInsertId;
				this.data.eventId = eventId;

				addParticipants({eventId: eventId, participants: participants,
					db: this.db}, callback);
			},
			function(callback) {
				var eventId = this.data.eventId;

				if (localization)
					this.db.addEventLocalization({eventId: eventId,
						location: location, date: ldate}, callback);
				else
					callback(null, null, null);
			},
			function(result, fields, callback) {
				this.db.getEventById({eventId: this.data.eventId}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('event read failed'));

				var event = result[0];
				var participants = this.data.participants;
				var localData = (localization ? {location: location, date: ldate} : null);

				event.participants = participants;
				event.localization = localData;
				event.creater = user.getUserInfo();
				event.acked = new Buffer(1);
				event.acked[0] = 0 // acked is 0 cause it's new event

				// reserve event
				eventManager.reserveEvent(event);

				var sessions = session.getUsersSessions(participants);

				event = lib.filterEventData(event);

				// user events to emit
				var userEvents = [];
				
				// push user events
				sessions.forEach(function(session) {
					userEvents.push(session.emitter.pushEvent('eventCreated', event));
				});

				// send email to every participants in background
				eventManager.sendMailAsync(event);

				callback(null, userEvents);
			}
		],
		function(err, userEvents) {
			if (err) {
				if (userEvents) {
					for (var i in userEvents) {
						userEvents[i].cancelEvent();
					}
				}
				user.emit('createEvent', {status: 'fail', errorMsg: 'server error'});
			} else {
				for (var i in userEvents) {
					userEvents[i].fireEvent();
				}
			}
		});
	});

	// user leaves event and group of event
	user.on('eventExit', function(data) {
		if (!session.validateRequest('eventExit', user, true, data))
			return;

		var eventId = parseInt(data.eventId);

		if (eventId !== eventId)
			return;

		dbManager.trxPattern([
			function(callback) {
				this.db.getEventById({eventId: eventId, update: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('You are not the event member or no such event'));

				this.data.event = result[0];

				// get participant don't need to be consistent in transaction so don't lock
				this.db.getEventParticipantByUser({eventId: eventId, userId: user.userId},
						callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('You are not the event member or no such event'));

				this.db.getEventParticipants({eventId: eventId, update: true}, callback);
			},
			function(result, fiedls, callback) {
				this.data.participants = result;

				this.db.removeEventParticipant({eventId: eventId, userId: user.userId},
						callback);
			},
			function(result, fields, callback) {
				if (result.affectedRows == 0)
					return callback('Failed to exit event');

				// event and event participants are write locked here
				if (this.data.participants.length == 1)
					this.db.removeEvent({eventId: eventId}, callback);
				else
					callback(null, null, null);
			},
			function(result, fiedls, callback) {
				if (result && result.affectedRows > 0)
					lib.debug('Event ' + eventId + ' is removed from db');

				var userSessions = session.getUserSessions(user);
				var sessions = session.getUsersSessions(this.data.participants);

				var userEvents = [];
				
				// notify exited user
				userSessions.forEach(function(user) {
					userEvents.push(user.emitter.pushEvent('eventExit', 
							{status: 'success', eventId: eventId}));
				});
				
				// notify other participants
				sessions.forEach(function(user) {
					if (userSessions.indexOf(user) >= 0)
						return;

					userEvents.push(user.emitter.pushEvent('eventParticipantExited', 
							{eventId: eventId, userId: user.userId}));
				});

				callback(null, userEvents);
			}
		],
		function(err, userEvents) {
			if (err) {
				if (userEvents) {
					for (var i in userEvents) {
						userEvents[i].cancelEvent();
					}
				}
				user.emit('eventExit', {status: 'fail', errorMsg: 'server error'});
			} else {
				for (var i in userEvents) {
					userEvents[i].fireEvent();
				}
				
				var groupId = this.data.event.groupId;
				// if event has a group, exit from the group
				if (groupId) {
					setTimeout(function() {
						group.exitGroup({groupId: groupId, user: user, trx: true},
								function(err, message, events) {
							if (err) {
								if (events) {
									for (var i in events) {
										events[i].cancelEvent();
									}
								}
							} else {
								for (var i in events) {
									events[i].fireEvent();
								}
								
								if (message) {
									// Send member exit message
									setTimeout(function() {
										lib.debug(message);
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
					},
					0);
				}
			}
		});
	});

	// acknowledge that the user have seen event creation and start
	user.on('eventAck', function(data) {
		if (!session.validateRequest('eventAck', user, true, data))
			return;

		var eventId = parseInt(data.eventId);
		var ack = parseInt(data.ack);

		if (eventId !== eventId ||
				ack !== ack)
			return;

		dbManager.trxPattern([
			function(callback) {
				this.db.getEventParticipantByUser({eventId: eventId, userId: user.userId,
					update: true}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('You are not the event participant or no such event'));

				// no locking
				this.db.getEventById({eventId: eventId}, callback);
			},
			function(result, fields, callback) {
				if (result.length == 0)
					return callback(new Error('database inconsistent'));

				var event = result[0];
				var started = event.started.readUIntLE(0, 1);

				if (started > 0 && ack < 3 && ack > 0) {
					this.db.updateEventParticipantAck({eventId: eventId, userId: user.userId,
						acked: ack}, callback);
				} else if (started == 0 && ack < 2 && ack > 0) {
					this.db.updateEventParticipantAck({eventId: eventId, userId: user.userId,
						acked: ack}, callback);
				} else {
					callback(new Error('bad ack'));
				}
			},
			function(result, fields, callback) {
				if (result.affectedRows == 0)
					return callback('Failed to update');

				var sessions = session.getUserSessions(user);

				var userEvents = [];
				// notify user ack
				sessions.forEach(function(user) {
					userEvents.push(user.emitter.pushEvent('eventAck', 
							{status: 'success', eventId: eventId, acked: ack}));
				});

				callback(null, userEvents);
			}
		],
		function(err, userEvents) {
			if (err) {
				if (userEvents) {
					for (var i in userEvents) {
						userEvents[i].cancelEvent();
					}
				}
				user.emit('eventAck', {status: 'fail', errorMsg: 'server error'});
			} else {
				for (var i in userEvents) {
					userEvents[i].fireEvent();
				}
			}
		});
	});
}

// get event list of user
var getEventList = dbManager.composablePattern(function(pattern, callback) {
	var userId = this.data.userId;

	pattern([
		function(callback) {
			this.db.getEventListByUser({userId: userId}, callback);
		},
		function(result, fields, callback) {
			var events = result;
			this.data.events = events;
			var db = this.db;

			lib.recursion(function(i) {
				return i < events.length;
			},
			function(i, callback) {
				var event = events[i];
				var participants;
				var localization;

				async.waterfall([
					function(callback) {
						db.getUserById({userId: event.createrId}, callback);
					},
					function(result, fiedls, callback) {
						if (result.length == 1)
							event.creater = result[0];

						db.getEventParticipants({eventId: event.eventId}, callback);
					},
					function(result, fiedls, callback) {
						event.participants = result;

						db.getEventLocalization({eventId: event.eventId}, callback);
					},
					function(result, fields, callback) {
						if (result.length == 1)
							localization = result[0];

						event.localization = localization;

						callback(null);
					}
				],
				callback);
			},
			callback);
		}
	],
	function(err) {
		if (err)
			callback(err);
		else
			callback(null, lib.filterEventsData(this.data.events));
	});
});

// input: data.user, data.emails(array of email)
var getParticipants = dbManager.composablePattern(function(pattern, callback) {
	var user = this.data.user;
	var emails = this.data.emails;

	if (!emails)
		return callback(null, []);

	pattern([
		function(callback) {
			var validps = [];
			var db = this.db;
			this.data.participants = validps;

			lib.recursion(function(i) {
				return i < emails.length;
			},
			function(i, callback) {
				dbManager.atomicPattern([
					function(callback) {
						var email = emails[i];
						// get user info
						this.db.getUserByEmail({email: email, lock: true}, callback);
					},
					function(result, fields, callback) {
						if (result.length == 0)
							return callback(new Error('no such user'));

						var peer = result[0];
						this.data.peer = peer;

						this.db.getAcceptedContact({userId: user.userId, userId2: peer.userId,
							lock: true}, callback);
					},
					function(result, fields, callback) {
						if (result.length == 0)
							return callback(new Error('You can invite only your contacts'));

						// valid contact
						validps.push(lib.filterUserData(this.data.peer));

						callback(null);
					}
				],
				callback,
				{db: db});
			},
			callback);
		}
	],
	function(err) {
		if (err)
			callback(err);
		else
			callback(null, this.data.participants);
	});
});

// input: data.eventId, data.participants(array of user info)
var addParticipants = dbManager.composablePattern(function(pattern, callback) {
	var eventId = this.data.eventId;
	var participants = this.data.participants;

	if (!participants)
		return callback(null);

	pattern([
		function(callback) {
			var db = this.db;

			lib.recursion(function(i) {
				return i < participants.length;
			},
			function(i, callback) {
				var participant = participants[i];

				async.waterfall([
					function(callback) {
						// get user info

						db.addEventParticipant({eventId: eventId,
							userId: participant.userId}, callback);
					}
				],
				function(err) {
					callback(err);
				});
			},
			callback);
		}
	],
	function(err) {
		if (err)
			callback(err);
		else
			callback(null);
	});
});

// Get event and localization data by event id
var getEvent = dbManager.composablePattern(function(pattern, callback) {
	var eventId = this.data.eventId;
	var lock = this.data.lock;
	var update = this.data.update;

	pattern([
		function(callback) {
			this.db.getEventById({eventId: eventId,
				lock: lock, update: update}, callback);
		},
		function(result, fields, callback) {
			if (result.length == 0)
				return callback(new Error('no such event'));

			this.data.event = result[0];

			this.db.getEventParticipants({eventId: eventId,
				lock: lock, update: update}, callback);
		},
		function(result, fields, callback) {
			this.data.event.participants = result;

			this.db.getUserById({userId: this.data.event.createrId,
				lock: lock, update: update}, callback);
		},
		function(result, fields, callback) {
			if (result.length == 1)
				this.data.event.creater = result[0];

			this.db.getEventLocalization({eventId: eventId,
				lock: lock, update: update}, callback);
		},
		function(result, fields, callback) {
			if (result.length == 1)
				this.data.event.localization = result[0];

			callback(null);
		}
	],
	function(err) {
		callback(err, lib.filterEventData(this.data.event));
	});
});

// Sees every events and starts events in its time
var eventManager = {
	init: function() {
		var manager = this;
		var fs = require('fs');

		fs.readFile(__dirname + '/mail.html', 'utf8', function (err,data) {
			  if (err) {
				  lib.debug(err);
			    throw new Error('Failed to read mail.html');
			  }
			  manager.mailTemplate = data;
			});

		var manager = this;

		dbManager.trxPattern([
			function(callback) {
				this.db.getUpcomingEvents({lock: true}, callback);
			},
			function(result, fields, callback) {
				var db = this.db;

				lib.recursion(function(i) {
					return i < result.length;
				},
				function(i, callback) {
					// init
					if (i == 0) {
						this.data.date = new Date();
					}

					var event = result[i];
					var date = this.data.date;

					if (event.date <= date) {
						setTimeout(function() {
							manager.startEvent({event: event, trx: true}, function(err) {
								lib.debug("event start error " + err);
							}, 0);
						});
					} else {
						manager.reserveEvent(event);
					}
					
					callback(null);
				},
				callback);
			}
		],
		function(err) {
			if (err) {
				throw new Error('Failed to load event. Please retart server');
			}
		});
	},
	upcomingEvents: [],
	reserveEvent: function(event) {
		var now = new Date();
		var fire = event.date;
		var left = fire - now;
		var manager = this;

		lib.debug('event \'' + event.name + '\'(' + event.eventId + ') will start after ' +
				Math.floor(left / 1000) + ' sec');
		this.upcomingEvents.push(event);

		// when left <= 0, setTimeout scheduled immediately as next
		setTimeout(function() {
			manager.startEvent({event: event, trx: true}, function(err) {
				var index = manager.upcomingEvents.indexOf(event);

				if (index >= 0)
					manager.upcomingEvents.splice(index, 1);
			});
		}, left);
	},
	startEvent: dbManager.composablePattern(function(pattern, callback) {
		var event = this.data.event;
		var eventId = event.eventId;

		lib.debug('start event \'' + event.name + '\'(' + eventId + ')');

		pattern([
			function(callback) {
				this.db.getEventParticipants({eventId: eventId, lock: true}, callback);
			},
			function(result, fields, callback) {
				this.data.participants = result;

				// get event creator information
				this.db.getUserById({userId: event.createrId, lock: true}, callback);
			},
			function(result, fields, callback) {
				var user;
				if (result.length == 1)
					user = result[0];

				var participants = this.data.participants;
				if (user && !lib.containsUser(user, participants))
					user = null;

				group.addGroup({name: event.name, user: user,
					members: participants.map(function(p) {return p.email;}),
					db: this.db}, callback);
			},
			function(group, callback) {
				this.data.group = group;
				var groupId = group.groupId;

				// update started bit
				this.db.updateEventStarted({eventId: eventId}, callback);
			},
			function(result, fields, callback) {
				if (result.affectedRows == 0)
					return callback(new Error('failed to update event'));

				this.db.updateEventGroupChat({groupId: this.data.group.groupId,
					eventId: eventId}, callback);
			},
			function(result, fields, callback) {
				if (result.affectedRows == 0)
					return callback(new Error('failed to update event'));

				// event, participants are locked from here
				getEvent({eventId: eventId, db: this.db}, callback);
			},
			function(event, callback) {
				var group = this.data.group;
				var participants = this.data.participants;
				var extend = require('util')._extend;
				
				var sessions = session.getUsersSessions(group.members);

				var userEvents = [];
				// notify users new group and that the event has been started
				sessions.forEach(function(member) {
					var copiedEvent = extend({}, event);

					// find participant info matching user and set ack attribute
					for (var i = 0; i < participants.length; i++) {
						var participant = participants[i];

						if (participant.userId == member.userId) {
							copiedEvent.acked = participant.acked.readUIntLE(0, 1);

							userEvents.push(member.emitter.pushEvent('addGroup', 
									{status: 'success', group: group}));
							userEvents.push(member.emitter.pushEvent('eventStarted', 
									copiedEvent));

							break;
						}
					}
				});

				// join every member to group chat
				chatManager.joinGroupChat({groupId: group.groupId, users: sessions}, function(err) {
					if (err) {
						return callback(err, userEvents);
					} else {
						return callback(null, userEvents);
					}
				});
			}
		],
		function(err, userEvents) {
			if (err) {
				if (userEvents) {
					for (var i in userEvents) {
						userEvents[i].cancelEvent();
					}
				}
				
				var group = this.data.group;
				if (group) {
					// remove group chat
					chatManager.removeGroupChatByGroupId(group.groupId);
				}
				
				lib.debug('start reserved event failed');
				lib.debug(err);
			} else {
				for (var i in userEvents) {
					userEvents[i].fireEvent();
				}
			}
			callback(err);
		});
	}),
	mailTemplate:null,
	// send mail notification to users
	sendMailAsync: function(event) {
		var mailTemplate = this.mailTemplate;

		setTimeout(function() {
			// gmail account id: homingpigeonHelper@gamil.com, password: udomk0yFQCK87yxwp4Fz
			var transporter = nodemailer.createTransport('smtps://homingpigeonHelper%40gmail.com:udomk0yFQCK87yxwp4Fz@smtp.gmail.com');

			var participants = event.participants.filter(function(p) {return p;});
			var creater;

			// find creater of the event
			for (var i = 0; i < event.participants.length; i++) {
				var participant = participants[i];

				if (event.creater && event.creater.userId &&
						participant.userId == event.creater.userId)
					creater = participant;
			}

			// formatting functions
			var getUserStr = function(user) {
				if (!user)
					return na;

				return user.nickname + '(' + user.email + ')';
			};

			var getDateStr = function(date) {
				if (!date)
					return na;

				return date.toDateString() + ' ' + date.toLocaleTimeString();
			};

			// present this when fields is not applicable
			var na = 'N/A';

			var content = mailTemplate;
			content = content.replace(new RegExp('%eventname', 'g'), event.name);
			content = content.replace(new RegExp('%creater', 'g'), getUserStr(creater));
			content = content.replace(new RegExp('%description', 'g'), event.description || na);
			content = content.replace(new RegExp('%discussiondate', 'g'), getDateStr(event.date) || na);
			if (event.localization) {
				var localization = event.localization;
				content = content.replace(new RegExp('%location', 'g'), localization.location || na);
				content = content.replace(new RegExp('%meetingdate', 'g'), getDateStr(localization.date));
			}  else {
				content = content.replace(new RegExp('%location', 'g'), na);
				content = content.replace(new RegExp('%meetingdate', 'g'), na);
			}
			if (participants)
				var participantsStr = participants.map(function(p) {return getUserStr(p);}).join('<br>');
			else
				var participantsStr = na;
			content = content.replace(new RegExp('%participants', 'g'), participantsStr);

			lib.recursion(function(i) {
				return i < participants.length;
			},
			function(i, callback) {
				var participant = participants[i];

				// put user name
				var finalContent = content.replace(new RegExp('%username', 'g'), participant.nickname);

				(function(to, content) {
					// setup e-mail data with unicode symbols
					var mailOptions = {
					    from: '"HomingPigeon" <homingpigeonHelper@gamil.com>', // sender address
					    to: to, // list of receivers
					    subject: '[HomingPigeon] You just have received a new event!', // Subject line
					    //text: 'Hello world ?', // plaintext body
					    html: content // html body
					};

					// send mail with defined transport object
					transporter.sendMail(mailOptions, function(err, info){
					    if(err){
					    	lib.debug(err);
					    } else {
					    	lib.debug('Sent email to ' + participant.email + ': ' + info.response);
					    }
					    callback(err);
					});
				})(participant.email, finalContent);
			});
		}, 100);
	},
};


// start event manager
(function() {
	eventManager.init();
})();

module.exports = {init: init};

var session = require('./session');
var chatManager = require('./chatManager');
var group = require('./group')
var lib = require('./lib');
var async = require('async');
