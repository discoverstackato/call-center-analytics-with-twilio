var env = process.env.NODE_ENV || 'dev'
var path = require('path')

if (env == 'dev') {
  require('dotenv').load()
  //TODO: change this when running ngrok
  var twiMLUrl = "http://77a199c4.ngrok.io/twilioVoice"

} else {
  // var twiMLUrl = path.join(__dirname, 'twilioVoice')
  var twiMLUrl = "http://callcenteranalytics.54.208.251.235.nip.io/twilioVoice"
}

//debugger
var express = require('express')
var app = express()
var http = require('http').Server(app);

var bodyParser = require('body-parser')
var urlencoded = bodyParser.urlencoded({extended: false})
var mongoose = require('mongoose')
var async = require('async')
// BUGFIX: send alert to client when we have obtained a recording
var socket = require('socket.io')(http);
var havenondemand = require('havenondemand')

app.use(urlencoded)
app.use(express.static(path.join(__dirname, 'public')))
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

// app.locals({
//   makeTable  : function(obj) {
//     var template = fs.readFileSync('makeList.ejs', 'utf-8')
//     return ejs.render(template, list)
//   }
// })

var port = process.env.PORT || 5000
var uristring = null;

// {
//   "mongodb": [{
//    "name": "foo-mongo-db",
//    "label": "mongodb-2.4",
//    "tags": [],
//    "plan": "free",
//    "credentials": {
//      "hostname": "10.1.1.18",
//      "host": "10.1.1.18",
//      "port": 15006,
//      "username": "6a28f7fa-e6d9-420a-b38f-98b48874a729",
//      "password": "93c30191-5ef3-4c6c-a1bf-f571f7700d04",
//      "name": "b6b23f4c-b485-4d0c-a16b-1d55a3f9bad6",
//      "db": "db",
//      "uri": "mongodb://192.168.99.100/twiliodb"
//    }
//  }]
// }

// {
//   "hod-demo": [
//     {
//       "credentials": {
//         "HOD_API_KEY": "285e54b2-b31a-4181-a9d9-6c09fcd37212"
//       },
//       "syslog_drain_url": null,
//       "label": "hod-demo",
//       "provider": null,
//       "plan": "default",
//       "name": "callcenteranalytics-HOD",
//       "tags": [
//         "hod-demo"
//       ]
//     }
//   ],
//   "mongo-dev": [
//     {
//       "credentials": {
//         "db": "df70fd699faf14848b6eaaa59da70345d",
//         "host": "mongo.my-mongo.svc.cluster.ucp",
//         "hostname": "mongo.my-mongo.svc.cluster.ucp",
//         "name": "df70fd699faf14848b6eaaa59da70345d",
//         "password": "MFbsY08TbmSmj5cTYPKSXENk2a2EHpRndihXwa1yp5c",
//         "port": "27017",
//         "uri": "mongodb://32668d69e5ba974d:MFbsY08TbmSmj5cTYPKSXENk2a2EHpRndihXwa1yp5c@mongo.my-mongo.svc.cluster.ucp:27017/df70fd699faf14848b6eaaa59da70345d;",
//         "username": "32668d69e5ba974d"
//       },
//       "syslog_drain_url": null,
//       "label": "mongo-dev",
//       "provider": null,
//       "plan": "default",
//       "name": "mongo-demo",
//       "tags": [
//         "mongo-dev"
//       ]
//     }
//   ]
// }

var uriString = null;
if(process.env.VCAP_SERVICES == null) {
   uriString = process.env.MONGOLAB_URI || process.env.MONGOHQ_URL || process.env.MONGO_LOCAL_URL || 'mongodb://localhost/test'
} else {
  console.log("VCAP_SERVICES="+ process.env.VCAP_SERVICES);
  var services = JSON.parse(process.env.VCAP_SERVICES);


  if (services) {
    var isStackato = process.env.IS_STACKATO || false;
    var mongoServiceName = process.env.MONGO_SERVICE_NAME || "mongo-dev";

    if(isStackato == true) {
      if (services[mongoServiceName]) {
       services[mongoServiceName].forEach(function (entry) {
           if (entry.name === (process.env.STACKATO_APP_NAME + "-"+mongoServiceName)) {
             uriString = entry.credentials.uri;
           }
       });
      }
    } else {


      if (services[mongoServiceName]) {
        uriString = services[mongoServiceName][0].credentials.uri;
        console.log("mongo URI = " + uriString);
      } else {
        console.log("no expected services block of "+mongoServiceName+ " found");
      }

      var hodServiceName = process.env.HODSERVICESNAME || "hod-demo";
      var hodClient = null;

      if(services[hodServiceName]) {
        hodApiKey = services[hodServiceName][0].credentials.HOD_API_KEY;
        console.log("Haven OnDemand API key = "+hodApiKey);
        hodClient = new havenondemand.HODClient(hodApiKey);

      } else {
         hodClient = new havenondemand.HODClient(process.env.HOD_APIKEY);
      }
    }

  }
}



var twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

var languageObj ={'en-US-tel': {'regular': 'US English', 'sentiment-analysis': 'eng'}, 'en-GB-tel': {'regular': 'British English', 'sentiment-analysis': 'eng'}, 'es-ES-tel': {'regular': 'European Spanish', 'sentiment-analysis': 'spa'}, 'fr-FR-tel': {'regular': 'French', 'sentiment-analysis': 'fre'}}

mongoose.connect(uriString, function (err, res) {
  if (err) {
  console.log ('ERROR connecting to: ' + uristring + '. ' + err);
  } else {
  console.log ('Succeeded connected to: ' + uristring);
  }
})

var schema = new mongoose.Schema({
  created: { type: Date, default: Date.now },
  processed: { type: Boolean, default: false },
  processing: { type: Boolean, default: false },
  error: { type: Boolean, default: false },
  indexed: { type: Boolean, default: false },
  audio: { type: Boolean, default: false },
  obtainingAudio: { type: Boolean, default: false },
  concepts: mongoose.Schema.Types.Mixed,
  sentiments: mongoose.Schema.Types.Mixed,
  entities: mongoose.Schema.Types.Mixed,
  entitiesSelected: [],
  confidence: Number,
  language: String,
  indexReference: String,
  ApiVersion: String,
  TranscriptionType: String,
  TranscriptionUrl: String,
  TranscriptionSid: String,
  Called: String,
  RecordingSid: String,
  CallStatus: String,
  RecordingUrl: String,
  From: String,
  Direction: String,
  url: String,
  AccountSid: String,
  TranscriptionText: String,
  Caller: String,
  TranscriptionStatus: String,
  CallSid: String,
  To: String
})

var Call = mongoose.model('Call', schema);

app.get('/', function(req, res) {
  var query = Call.find({})
  query.exec(function(err, calls) {
    if (err) {
      return handleError(err)
    } else {
      res.render('index', {
        calls: calls
      })
    }
  })
})

app.get('/about', function(req, res) {
  res.render('about', {

  })
})

app.post('/search', function(req, res) {
  //debugger
  var searchText = req.body.search
  var data = {text: searchText, index: process.env.HOD_INDEX_NAME, print: 'all'}
  hodClient.call('querytextindex', data, function(err, resp, body) {
    if (resp) {
      if (resp.body) {
        if (resp.body.status == 'failed') {
          var documents = []
        } else {
          //debugger
          var documents = resp.body.documents
        }
        res.render('search_results', {
          calls: documents
        })
      }
    }
  })
})

app.get('/findSimilar', function(req, res) {
  //debugger
  var indexReference = req.query.indexReference
  var data = {index_reference: indexReference, indexes: process.env.HOD_INDEX_NAME, print: 'all'}
  hodClient.call('findsimilar', data, function(err, resp, body) {
    if (resp) {
      if (resp.body) {
        //debugger
        var documents = resp.body.documents
        res.render('find_similar_results', {
          calls: documents
        })
      }
    }
  })
})

app.get('/callcenter', function(req, res) {
  res.render('callcenter', {})
})

app.get('/call/:CallSid', function(req, res) {
  var CallSid = req.params.CallSid
  var query = Call.findOne({'CallSid': CallSid})
  query.exec(function(err, call) {
    if (err) {
      return handleError(err)
    } else {
      var language = languageObj[call.language]['regular']
      res.render('call', {
        call: call,
        language: language
      })
    }
  })
})

function obtainAudio(CallSid) {
  console.log("Obtaining audio")
  console.log(CallSid)
  twilioClient.calls(CallSid).get(function(err1, call) {
    console.log(call)
    if (err1) {
      console.log(err1)
    } else {
      var dateCreated = call.date_created
      twilioClient.recordings.get({
        callSid: CallSid,
      }, function(err2, data) {
        if (err2) {
          console.log(err2)
        } else {
          if (data.recordings.length > 0) { //if there is a recording
            console.log(data.recordings)
            data.recordings.forEach(function(recording) {
              //debugger
              var recordingUrl = "https://api.twilio.com"+recording.uri.split(".")[0]+".mp3"
              Call.update({'CallSid': CallSid}, {
                audio: true,
                RecordingUrl: recordingUrl,
                dateCreated: dateCreated
              }, function(err, numberAffected, rawResponse) {
                console.log("Audio file obtained for: " + CallSid)

                // BUGFIX: send alert to client when we have obtained a recording
                socket.emit('onComplete',{action:"audioObtained"});
              })
            })
          } else {
            obtainAudio(CallSid)
          }
        }
      })
    }
  })
}


app.get('/processCall', function(req, res) {
  //debugger
  var CallSid = req.query.CallSid
  var language = req.query.language
  var entityType = req.query.entity_type
  Call.findOne({ CallSid: CallSid }, function(error, doc1) {
    if (doc1.processing == false) {
      //
      console.log("Processing call: " + CallSid)
      Call.update({'CallSid': CallSid}, {
        processing: true,
        language: language,
        entitiesSelected: entityType
      }, function(error1, numberAffected, rawResponse) {
        //
        if (error1) {
          console.log(error1)
        } else {
          Call.findOne({ CallSid: CallSid }, function (error2, doc){
            // doc.name = 'jason borne'
            // doc.visits.$inc()
            // doc.save()
            if (error2) {

            } else {
              var recordingUrl = doc.RecordingUrl
              var To = doc.To
              var From = doc.From
              var dateCreated = doc.dateCreated
              //
              var data1 = {url: recordingUrl, language: language, interval: 0}
              // debugger
              hodClient.call('recognizespeech', data1, true, function(err1, resp1, body1) {
                var jobID = resp1.body.jobID
                // debugger
                getAsyncResult(jobID, function(body) {
                  // debugger
                  if (body == 'failed') {
                    createError(CallSid)
                  } else {
                    //continue
                    // var text = body.actions[0].result.document[0].content
                    var textSnippets = body.actions[0].result.document
                    //
                    processText(textSnippets, function(textObj) {
                      // debugger
                      var text = textObj.text
                      var confidenceAggregate = textObj.aggregate
                      //
                      console.log("Text: " + text)
                      if (text == "") {
                        createError(CallSid)
                      } else {
                        // HOD stuff
                        var sentimentAnalysisLanguage = languageObj[language]['sentiment-analysis']
                        var data2 = {text: text, language: sentimentAnalysisLanguage}
                        hodClient.call('analyzesentiment', data2, function(err2, resp2, body2) {
                          // debugger
                          console.log("Analyzed sentiment")
                          var sentimentResponse = body2
                          var aggregateSentiment = resp2.body.aggregate.sentiment
                          var aggregateScore = resp2.body.aggregate.score
                          hodClient.call('extractconcepts', data2, function(err3, resp3, body3) {
                            // debugger
                            console.log("Extracted concepts")
                            var conceptsResponse = body3
                            var data3 = {text: text, entity_type: entityType}
                            hodClient.call('extractentities', data3, function(err4, resp4, body4) {
                              console.log("Extracted entities")
                              var entityResponse = body4
                              //
                              //
                              var json = {
                                document: [
                                  {
                                    // title: counter.toString(),
                                    // body: body
                                    content: text,
                                    CallSid: CallSid,
                                    // sentiments: sentimentResponse,
                                    aggregate_sentiment: aggregateSentiment,
                                    aggregate_score: aggregateScore,
                                    // concepts: conceptsResponse,
                                    RecordingUrl: recordingUrl,
                                    TranscriptionText: text,
                                    confidence: confidenceAggregate,
                                    From: From,
                                    To: To,
                                    date: dateCreated,
                                    language: language
                                  }
                                ]
                              }
                              var data4 = {
                                index: process.env.HOD_INDEX_NAME,
                                json: JSON.stringify(json)
                              }
                              // debugger
                              hodClient.call('addtotextindex', data4, function(err5, resp5, body5) {
                                // mongo
                                // debugger
                                var indexReference = resp5.body.references[0].reference
                                Call.update({'CallSid': CallSid}, {
                                  text: text,
                                  concepts: conceptsResponse,
                                  sentiments: sentimentResponse,
                                  entities: entityResponse,
                                  RecordingUrl: recordingUrl,
                                  TranscriptionText: text,
                                  indexed: true,
                                  processed: true,
                                  confidence: confidenceAggregate,
                                  indexReference: indexReference
                                }, function(err, numberAffected, rawResponse) {
                                  // BUGFIX: send alert to client when we have obtained a recording
                                  socket.emit('onComplete',{action:"callProcessed"});
                                  console.log("Processed")
                                })
                                //
                              })
                              //
                            })
                          })
                        })
                      }
                      // HOD stuff
                      //
                    })
                  }
                })
              })
              //

            }
          })
        }
      })

      //
    } else {
      console.log("Call already processing! " + CallSid)
      res.redirect('/')
    }
  })
})

function getAsyncResult(jobID, callback) {
  hodClient.getJobStatus(jobID, function(err, resp, body) {
    // debugger
    if (resp.body['status'] != 'finished') {
      if (resp.body.actions[0].status == 'failed') {
        callback('failed')
      } else {
        getAsyncResult(jobID, callback)
      }
    } else {
      callback(body)
    }
  })
}

function processText(textSnippetsArray, callback) {
  var oldAverage = 0
  var newAverage
  var counter = 1
  var text = ''
  async.each(textSnippetsArray, function(textInformation, c) {
    // debugger
    var confidence = textInformation['confidence']
    text += textInformation['content']
    newAverage = oldAverage * (counter-1)/counter + confidence/counter;   // New average = old average * (n-1)/n + new value /n
    oldAverage = newAverage; //set equal to new average for next go around of calling this function
    counter += 1
    console.log("Average: " + newAverage)
    console.log("confidence: " + confidence)
    if (counter > textSnippetsArray.length) {
      callback({aggregate: newAverage, text: text})
    }
    text += ' '
  }, function(err) {})
}

function createError(callSid) {
  Call.update({'CallSid': callSid}, {
    error: true
  }, function(err, numberAffected, rawResponse) {

  })
}

app.post('/makeCall', function(req, res) {
  // var query = req.query
  var phonenumber = req.body.phonenumber
  // var phoneNumber = query.phoneNumber
  twilioClient.calls.create({
      url: twiMLUrl,
      to: phonenumber,
      from: process.env.TWILIO_PHONE_NUMBER
  }, function(err, call) {
      if (err) {
        console.log(err)
      } else {
        console.log(call)
        process.stdout.write(call.sid)
        var callObj = {}
        callObj['CallSid'] = call.sid
        callObj['To'] = call.to
        callObj['From'] = call.from
        var callMongo = new Call (callObj)
        callMongo.save(function (err) {
          if (err)  {
            console.log ('Error on save!')
          } else { //loop to obtain audio
            obtainAudio(call.sid)
          }
        })
      }
  })
  res.redirect('/')
})

// Function for getting Twilio XML file
app.post('/twilioVoice', function(req, res) {
  var fileName = path.join(__dirname, '/twilioVoice.xml')
  res.sendFile(fileName, function (err) {
    if (err) {
      console.log(err)
    }
  })
})

http.listen(port, function() {
  console.log('Listening on port: ' + port)
})
