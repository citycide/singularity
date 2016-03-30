/*********************************** CONFIG ***********************************/
SimpleJsonStore = require('simple-json-store');

var config = new SimpleJsonStore('./config/config.json',
    {
        "port": 2016,
        "devMode": true,
        "setupComplete": false,
        "sessionSecret": "9347asfg597y43wernhy59072rw345",
        "clientID": "41i6e4g7i1snv0lz0mbnpr75e1hyp9p"
    }
);

module.exports = config;