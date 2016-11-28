//var socket = io.connect('http://vps332892.ovh.net:4000');
var socket = io.connect('http://192.249.22.38:3000');

function addMyMessage(msg, pseudo, date){
  $('.chat').append('<li class="right clearfix"><span class="chat-img pull-right"><img src="http://placehold.it/50/55C1E7/fff" alt="User Avatar" class="img-circle" /></span><div class="chat-body clearfix"><div class="header"><strong class="pull-right primary-font">'+pseudo+'</strong><small class="text-muted"><i class="fa fa-clock-o fa-fw"></i> '+date+'</small></div><p>'+msg+'</p></div></li>');/*'<div class="message"></p>' + pseudo + ' : ' + msg +   '</p></div>');*/
  $('.chatTog').animate({ scrollTop: 50000 }, 1);
}

function addMessage(msg, pseudo, date){
  $('.chat').append('<li class="left clearfix"><span class="chat-img pull-left"><img src="http://placehold.it/50/55C1E7/fff" alt="User Avatar" class="img-circle" /></span><div class="chat-body clearfix"><div class="header"><strong class="primary-font">'+pseudo+'</strong><small class="pull-right text-muted"><i class="fa fa-clock-o fa-fw"></i>'+date+'</small></div><p>'+msg+'</p></div></li>');/*'<div class="message"></p>' + pseudo + ' : ' + msg +   '</p></div>');*/
  $('.chatTog').animate({ scrollTop: 50000 }, 1);
}

//click on the send button
$("#btn-chat").on('click', function(){
  sentMessage();
  });

//check the pressed key and if it is enter then send message
$(document).keypress(function(e){
  if (e.which == 13){
    sentMessage();
  }
  });

//verification if text is not null then send to server and write it locally
function sentMessage(){
    if ($('.messageInput').val() != ""){
      socket.emit('message', $('.messageInput').val() , "user name", new Date().toString() );
      //socket.emit('message', $('.messageInput').val());    //the original one but without the id sent with it
      addMyMessage($('.messageInput').val(), "Me" , new Date().toString(), true);
      $('.messageInput').val(''); //reset the messageInput
    }
}

//Not my code something else to determine someone pseudo
function setPseudo(){
  if ($('#pseudoInput').val() != "" ){
    socket.emit('setPseudo',$('#pseudoInput').val());
    $("#chatControls").show();
    $("#pseudoInput").hide();
    $("#pseudoSet").hide();
  }
}

//to receive the message for us
socket.on('messageReception', function(message){
    addMessage(message['message'], message['id'], message['date']);
    console.log(message['message']);
    console.log(message['id']);
    console.log(message['date']);
});

//some interface stuff and buttons
$(function(){
  $("#chatControls").hide();
  $("#pseudoSet").click(function(){setPseudo()});
  $("#submit").click(function(){sentMessage()});
});
