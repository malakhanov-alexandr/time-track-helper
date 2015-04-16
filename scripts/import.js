var https = require( "https" );
var http = require( "http" );
var querystring = require( "querystring" );
var moment = require( "moment" );
var formData = require( 'form-data' );

var options = require( '../config.json' );

module.exports = function () {

    var date, from, to;
    if ( process.argv.length >= 4 ) {
        date = moment( process.argv[3] );
    } else {
        date = moment();
    }
    from = to = date.format( "YYYY-MM-DD" );

    var jiraProject = options.jira.project;
    var jiraAuth = options.jira.user + ":" + options.jira.pass;

    https.request( {
        hostname: options.jira.hostname,
        path: "/rest/api/latest/search?" + querystring.stringify( {
            "jql": "project='" + jiraProject + "' and timespent>0 and updated>" + from + " and assignee='" + options.jira.user + "'",
            "fields": "summary,worklog",
            "limit": 100
        } ),
        auth: jiraAuth
    }, function ( res ) {
        var data = "";
        res.on( "data", function ( chunk ) {
            data += chunk;
        } );
        res.on( "end", function () {
            var parsed = JSON.parse( data );
            var issues = parsed.issues;

            var current = 0;

            console.log( "start importing issues" );

            next();

            function next() {
                if ( current >= issues.length ) {
                    return finish();
                }
                var issue = issues[current];

                var subject = issue.key + " " + issue.fields.summary;

                http.request( {
                    hostname: options.redmine.hostname,
                    path: "/issues.json?" + querystring.stringify( {
                        subject: subject
                    } ),
                    headers: {
                        'X-Redmine-API-Key': options.redmine.api_key
                    }
                }, function ( res ) {
                    var data = "";
                    res.on( "data", function ( chunk ) {
                        data += chunk;
                    } );
                    res.on( "end", function () {
                        var parsed = JSON.parse( data );
                        if ( parsed.issues.length !== 1 ) {
                            var post = http.request( {
                                hostname: options.redmine.hostname,
                                path: "/issues.json",
                                method: "POST",
                                headers: {
                                    'X-Redmine-API-Key': options.redmine.api_key,
                                    'Content-Type': "application/json"
                                }
                            }, function ( res ) {
                                var data = "";
                                res.on( "data", function ( chunk ) {
                                    data += chunk;
                                } );
                                res.on( "end", function () {
                                    console.log( "created", data );
                                    return trackTime( current, JSON.parse( data ).issue.id );
                                } );
                            } );

                            post.write( JSON.stringify( {
                                issue: {
                                    project_id: options.redmine.import.projectId,
                                    subject: subject,
                                    author_id: options.redmine.userId,
                                    assigned_to_id: options.redmine.userId
                                }
                            } ) );

                            post.end();
                        } else {
                            trackTime( current, parsed.issues[0].id );
                        }
                    } );
                } ).end();
            }

            function trackTime( jiraIssueIndex, redmineIssueId ) {

                var time = issues[jiraIssueIndex].fields.worklog.worklogs;
                var currentTime = 0;

                nextTrackTime();

                function nextTrackTime() {

                    if ( currentTime >= time.length ) {
                        return finishTrackTime();
                    }

                    var worklog = time[currentTime];
                    var comment = worklog.comment.replace( /[\n\r]+/g, " " );
                    var timeUpdated = moment( worklog.started );

                    if ( timeUpdated.isBefore( from ) || worklog.author.key !== options.jira.user ) {
                        ++currentTime;
                        return nextTrackTime();
                    }

                    http.request( {
                        hostname: options.redmine.hostname,
                        path: "/time_entries.json?" + querystring.stringify( {
                            project_id: options.redmine.import.projectId,
                            issue_id: redmineIssueId,
                            user_id: options.redmine.userId
                        } ),
                        headers: {
                            'X-Redmine-API-Key': options.redmine.api_key
                        }
                    }, function ( res ) {
                        var data = "";
                        res.on( "data", function ( chunk ) {
                            data += chunk;
                        } );
                        res.on( "end", function () {
                            var parsedTimeEntries = JSON.parse( data );
                            var found = false;
                            for (var i in parsedTimeEntries.time_entries) {
                                if ( parsedTimeEntries.time_entries[i].comments === comment ) {
                                    found = true;
                                    break;
                                }
                            }
                            if ( found ) {
                                ++currentTime;
                                return nextTrackTime();
                            } else {
                                var postTime = http.request( {
                                    hostname: options.redmine.hostname,
                                    path: "/time_entries.json",
                                    method: "POST",
                                    headers: {
                                        'X-Redmine-API-Key': options.redmine.api_key,
                                        'Content-Type': "application/json"
                                    }
                                }, function ( res ) {
                                    var data = "";
                                    res.on( "data", function ( chunk ) {
                                        data += chunk;
                                    } );
                                    res.on( "end", function () {
                                        console.log( "logged time", data );
                                        ++currentTime;
                                        return nextTrackTime();
                                    } );
                                } );
                                var timeEntry = JSON.stringify( {
                                    time_entry: {
                                        project_id: options.redmine.import.projectId,
                                        user_id: options.redmine.userId,
                                        activity_id: 9,
                                        issue_id: redmineIssueId,
                                        spent_on: timeUpdated.format( "YYYY-MM-DD" ),
                                        hours: worklog.timeSpentSeconds / (60 * 60),
                                        comments: comment
                                    }
                                } );
                                postTime.write( timeEntry );

                                postTime.end();

                            }
                        } );
                    } ).end();
                }
            }

            function finishTrackTime() {
                ++current;
                next();
            }

            function finish() {
                console.log( "end." );
            }
        } );

    } ).end();

};