const mongoose = require("mongoose");

function getMongoConnectionState() {
	return mongoose.connection.readyState;
}

function isMongoConnected() {
	return getMongoConnectionState() === 1;
}

module.exports = {
	mongoose,
	getMongoConnectionState,
	isMongoConnected,
};
