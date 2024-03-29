CREATE DATABASE HomingPigeon CHARACTER SET utf8 COLLATE utf8_general_ci;
USE HomingPigeon;

CREATE TABLE Accounts (
    id int NOT NULL AUTO_INCREMENT,
    nickname varchar(32) NOT NULL,             /* User name in chat */
    email char(64) NOT NULL,
    password char(64) NOT NULL,                /* password hash string */
    lastSeen timestamp NOT NULL,
    picture varchar(32),                       /* Profile picture file name */
    login char(64) NOT NULL DEFAULT 'NO',
    CONSTRAINT Accounts_pk PRIMARY KEY (id)
);

-- Session data for users
CREATE TABLE Sessions (
    sessionId char(40) NOT NULL,                /* Session id generated with SHA-1 random hash value */
    accountId int NOT NULL,
    expires timestamp,
    CONSTRAINT Sessions_pk PRIMARY KEY (sessionId)
);

-- Contacts(Friends)
CREATE TABLE Contacts (
    id int NOT NULL AUTO_INCREMENT,
    accountId int NOT NULL,
    accountId2 int NOT NULL,
    accepted bit(1) NOT NULL DEFAULT 0,              /* if 0, accountId is waiting for accountId2 to accept */
    CONSTRAINT Contacts_pk PRIMARY KEY (id)
);

-- Group
CREATE TABLE Groups (
    id int NOT NULL AUTO_INCREMENT,
    name varchar(128) DEFAULT NULL,                   /* Group name */
    contactId int,                                    /* Contact id if this group is for contact chat */
    eventId int,                                      /* Event id if this group is for event chat */
    CONSTRAINT Groups_pk PRIMARY KEY (id)
);

-- Members in a Group
CREATE TABLE GroupMembers (
    groupId int NOT NULL,
    accountId int NOT NULL,
    ackStart int NOT NULL,                          /* the member start read from this message id */
    nbNewMessages int unsigned DEFAULT 0,           /* number of messages the user have not seen */
    alias varchar(128) DEFAULT NULL,                /* group alias only seen by the user instead of group name */
    CONSTRAINT GroupsMembers_pk PRIMARY KEY (groupId, accountId)
);

-- Message in a Group
CREATE TABLE Messages (
    id bigint unsigned NOT NULL AUTO_INCREMENT,
    groupId int NOT NULL,
    messageId int unsigned NOT NULL,                 /* Message id in this group */
    accountId int NOT NULL,
    messageType decimal(1) NOT NULL DEFAULT 0,       /* 0: Text, 1: joinGroup, 2: leftGroup, 3: image, 4: file share */
    date timestamp NOT NULL,
    nbread int NOT NULL DEFAULT 1,                   /* Number of not read */
    importance decimal(1) NOT NULL DEFAULT 0,        /* 0: Normal, 1: Important, 2: Very Important */
    content text NOT NULL,
    location varchar(64),                            /* Location sharing */
    CONSTRAINT Messages_pk PRIMARY KEY (id)
);

CREATE TABLE MessageAcks (
    id bigint unsigned NOT NULL AUTO_INCREMENT,
    groupId int NOT NULL,
    accountId int NOT NULL,
    ackStart int unsigned NOT NULL,                  /* The user read from here(inclusive) */
    ackEnd int unsigned NOT NULL,                    /* until here(inclusive) */
    CONSTRAINT MessagesAcks_pk PRIMARY KEY (id)
);

CREATE TABLE GroupHistory (
	groupId int NOT NULL,
	messageId int unsigned NOT NULL,
	accountId int NOT NULL,
	CONSTRAINT GroupHistory_pk PRIMARY KEY (groupId, messageId, accountId)
);

-- 
CREATE TABLE Localisations (
    id int NOT NULL AUTO_INCREMENT,
    eventId int,
    title varchar(128),                       	/* Location title */
    category varchar(128),						/* Location category */
    description varchar(256),					/* Location description */
    latitude float,								/* Latitude of location */
    longitude float,							/* Longitude of location */
    location varchar(25),                      	/* Location to meet */
    date timestamp NOT NULL,                   	/* Time for meeting */
    CONSTRAINT Localisations_pk PRIMARY KEY (id)
);

CREATE TABLE Events (
    id int NOT NULL AUTO_INCREMENT,
    name varchar(128) NOT NULL,
    nbParticipants int NOT NULL DEFAULT 0,
    nbParticipantsMax int NOT NULL,
    length int NOT NULL,                       /* Don't know what it means */
    date timestamp NOT NULL,                   /* Meeting time in chat */
    description varchar(1024),                 /* Text description of event */
    started bit(1) NOT NULL DEFAULT 0,         /* If the event started? */
    createrId int,                             /* Event creater account id */
    CONSTRAINT Events_pk PRIMARY KEY (id)
);

CREATE TABLE EventParticipants (
    eventId int NOT NULL,
    accountId int NOT NULL,
    acked bit(2) NOT NULL DEFAULT 0,           /* 0: not seen, 1: seen event, 2: seen started */
    status varchar(25),
    CONSTRAINT EventParticipants_pk PRIMARY KEY (eventId, accountId)
);

-- Accounts
ALTER TABLE Accounts ADD UNIQUE INDEX Accounts_Email (email);

-- Sessions
ALTER TABLE Sessions ADD CONSTRAINT Sessions_Accounts FOREIGN KEY (accountId)
    REFERENCES Accounts (id) ON UPDATE CASCADE ON DELETE CASCADE;
    
-- Contacts
ALTER TABLE Contacts ADD INDEX Contacts_Account1_Account2 (accountId, accountId2);
ALTER TABLE Contacts ADD INDEX Contacts_Account2_Account1 (accountId2, accountId);

ALTER TABLE Contacts ADD CONSTRAINT Contacts_Accounts FOREIGN KEY (accountId)
    REFERENCES Accounts (id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE Contacts ADD CONSTRAINT Contacts_Accounts2 FOREIGN KEY (accountId2)
    REFERENCES Accounts (id) ON UPDATE CASCADE ON DELETE CASCADE;

-- Groups
ALTER TABLE Groups ADD INDEX Groups_ContactId_Id (contactId, id);

ALTER TABLE Groups ADD CONSTRAINT Groups_ContactId FOREIGN KEY (contactId)
    REFERENCES Contacts (id) ON UPDATE CASCADE ON DELETE SET NULL;
    
ALTER TABLE Groups ADD CONSTRAINT Groups_EventId FOREIGN KEY (eventId)
    REFERENCES Events (id) ON UPDATE CASCADE ON DELETE SET NULL;

-- GroupMembers
ALTER TABLE GroupMembers ADD INDEX GroupMembers_Accounts_Groups (accountId, groupId);

ALTER TABLE GroupMembers ADD CONSTRAINT GroupMembers_GroupId FOREIGN KEY (groupId)
    REFERENCES Groups (id) ON UPDATE CASCADE ON DELETE CASCADE;
    
ALTER TABLE GroupMembers ADD CONSTRAINT GroupMembers_AccountId FOREIGN KEY (accountId)
    REFERENCES Accounts (id) ON UPDATE CASCADE ON DELETE CASCADE;
    
-- Messages
-- order of id must be same as order of date 
ALTER TABLE Messages ADD INDEX Messages_GroupId_Id (groupId, id);
ALTER TABLE Messages ADD INDEX Messages_GroupId_Timestamp (groupId, date);
ALTER TABLE Messages ADD UNIQUE INDEX Messages_GroupId_MessageId (groupId, messageId);

ALTER TABLE Messages ADD CONSTRAINT Messages_GroupId FOREIGN KEY (groupId) 
    REFERENCES Groups(id) ON UPDATE CASCADE ON DELETE CASCADE;
    
-- Group Histories
ALTER TABLE GroupHistory ADD CONSTRAINT GroupHistory_MessageId FOREIGN KEY (groupId, messageId) 
    REFERENCES Messages (groupId, messageId) ON UPDATE CASCADE ON DELETE CASCADE;
    
-- MessageAcks
ALTER TABLE MessageAcks ADD INDEX MessageAcks_AckStart (ackStart, ackEnd);
ALTER TABLE MessageAcks ADD INDEX MessageAcks_AckEnd (ackEnd, ackStart);

ALTER TABLE MessageAcks ADD CONSTRAINT MessageAcks_GroupId_Accounts FOREIGN KEY (groupId, accountId) 
    REFERENCES GroupMembers (groupId, accountId) ON UPDATE CASCADE ON DELETE CASCADE;
    
-- Localisations
ALTER TABLE Localisations ADD CONSTRAINT Localisations_EventId FOREIGN KEY (eventId)
    REFERENCES Events (id) ON UPDATE CASCADE ON DELETE CASCADE;
    
-- Events
ALTER TABLE Events ADD CONSTRAINT Events_AccountId FOREIGN KEY (createrId)
    REFERENCES Accounts (id) ON UPDATE CASCADE ON DELETE CASCADE;
    
ALTER TABLE EventParticipants ADD INDEX EventParticipants_Accounts_Events (accountId, eventId);

ALTER TABLE EventParticipants ADD CONSTRAINT EventParticipants_EventId FOREIGN KEY (eventId)
    REFERENCES Events (id) ON UPDATE CASCADE ON DELETE CASCADE;
    
ALTER TABLE EventParticipants ADD CONSTRAINT EventParticipants_AccountId FOREIGN KEY (accountId)
    REFERENCES Accounts (id) ON UPDATE CASCADE ON DELETE CASCADE;
    
/*
ALTER TABLE Contacts ADD status TINYINT DEFAULT 0;
ALTER TABLE GroupMembers ADD status TINYINT DEFAULT 0;
*/
-- Message trigger
/*
delimiter #

create trigger Group_Message_Id before insert on Messages
for each row
begin
declare mId int unsigned default 0;
select if(max(messageId), max(messageId) + 1, 0) into mId from Messages where groupId = new.groupId lock in share mode;
  if not (mId > 0) then
    set mId = 1;
  end if;
  set new.messageId = mid;
end#

delimiter ;
*/