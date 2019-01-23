<?php
  session_start();
  include_once 'dbconnect.php';
?>

<!DOCTYPE html>

<html>
<head>
    <title>Homing Pigeon</title>
    
    <style type="text/css">
    .link {
    	text-decoration: underline;
    	color:blue;
    }
    </style>
</head>
<body>


  <h1> Homing Pigeon </h1>

  <!-- Session info and logout option -->
  <?php if (isset($_SESSION['usr_id'])) {
    header("Location:Home/index.php");
  } else { ?>

    <p>
      <a href="login.php">Login</a>
      <br/>
      <a href="register.php">Sign Up</a>
    </p>
    <script>
    function moveToAnotherPort(port) {
        location.href = 'https://' + location.hostname + ':' + port
    }
    </script>
    <p>
      Please visit these pages to accept the certificates :
      <a class="link" onclick="moveToAnotherPort(4000)">4000</a>
      <!-- <a class="link" onclick="moveToAnotherPort(443)">8888</a>  -->
      <!-- https://vps332892.ovh.net -->
    </p>

  <?php } ?>






</body>
</html>
