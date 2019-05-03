const lib = require('./lib');
const fs = require('fs');
const sharp = require('sharp');

var thumbnailMaxWidth = 256;
var thumbnailMaxHeight = 256;

var createThumbnailImage = function(imageName, callback) {
	// Split path name
	var splits = imageName.split('.');
	
	if (splits.length <= 1) {
		return callback(new Error('No extension'));
	}
	
	// Get extension of file
	var ext = splits[splits.length - 1];
	
	// Get directory path of images
	var dir = contentManager.contentType.image.dir;
	
	// Make thumbnail file name and paths
	var tFileName = splits.slice(0, splits.length - 1).join('.') + '_thumbnail.' + ext;
	var tFilePath = dir + '/' + tFileName;
	
	// Original file path
	var oFilePath = dir + '/' + imageName;
	
	// Create transform
	let transform = sharp(oFilePath);
	
	// Get image size
	transform.metadata()
		.then(function(metadata) {
			let width, height;
			
			// Get width and heights of image
			width = metadata.width;
			height = metadata.height;
			
			// Get resize factor
			var factor = Math.min(thumbnailMaxWidth / width, thumbnailMaxHeight / height);
			 
			let resizeWidth, resizeHeight;
			
			if (factor < 1) {
				// Image should be resized smaller
				resizeWidth = Math.floor(width * factor);
				resizeHeight = Math.floor(height * factor);
				
				// Resize file and save as file
				transform.toFormat(ext)
					.resize(resizeWidth, resizeHeight)
					.toFile(tFilePath)
					.then((info) => {
						// Start callback
						callback(null);
					});
			} else {
				// Small image, we do not need to resize the image
				fs.readFile(oFilePath, function(err, data) {
					if (err) {
						return callback(err);
					}
					
					fs.writeFile(tFilePath, data, function(err) {
						if (err) {
							return callback(new Error('Failed to save file'));
						}
						
						callback(null);
					});
				});
			}
		});
}


module.exports = {
	createThumbnailImage: createThumbnailImage
};

const contentManager = require('./contentManager');