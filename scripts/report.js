var http = require("http");
var moment = require("moment");
var formData = require('form-data');
var Q = require("q");

var options = require( '../config.json' );

module.exports = function () {

    var from, to;
    if (process.argv.length >= 5) {
        from = moment(process.argv[3]);
        to = moment(process.argv[4]);
        next();
        function next() {
            if (from.isBefore(to) || from.isSame(to)) {
                report(moment(from)).then(function () {
                    next();
                    from.add(1, "d");
                });
            } else {
                return;
            }
        }

    }
    if (process.argv.length >= 4) {
        report(moment(process.argv[3]));
    } else {
        report(moment());
    }

    function report(moment) {

        return Q.Promise(function (resolve, reject) {

            var date = moment.format("YYYY-MM-DD");

            function formatCookie(res, cookie) {
                if (!res.headers["set-cookie"]) {
                    return cookie;
                }
                return res.headers["set-cookie"].join("").replace(/;.*$/, "");
            }

            function getToken(data) {
                return data.match(/\n\s*<meta content="(.*?)"\s+name="csrf-token"\s*\/>/);
            }

            var host = options.redmine.hostname;

            var req = http.request({
                hostname: host,
                path: "/time_entries.json?limit=100&period_type=2&from=" + date + "&to=" + date,
                headers: {
                    'X-Redmine-API-Key': options.redmine.api_key
                }
            }, function (res) {
                var cookie = formatCookie(res, cookie);
                var data = '';
                res.on('data', function (chunk) {
                    data += chunk;
                });
                res.on('end', function () {
                    var parsed = JSON.parse(data);
                    var description = "";
                    var news = {
                        "news[title]": "DR " + moment.format("DD.MM.YYYY"),
                        "news[summary]": "",
                        "news[spinned]": 0,
                        "commit": "create"
                    };

                    var current = 0;
                    var issues = {};

                    next();

                    function next() {
                        if (current >= parsed.time_entries.length) {
                            return finish();
                        }
                        if (parsed.time_entries[current].issue) {
                            http.request({
                                hostname: host,
                                path: "/issues/" + parsed.time_entries[current].issue.id + ".json",
                                headers: {
                                    'X-Redmine-API-Key': options.redmine.api_key
                                }
                            }, function (res) {
                                cookie = formatCookie(res, cookie);
                                var issue = '';
                                res.on('data', function (chunk) {
                                    issue += chunk;
                                });
                                res.on('end', function () {
                                    issues[parsed.time_entries[current].issue.id] = JSON.parse(issue).issue.subject;
                                    ++current;
                                    return next();
                                });
                            }).end();
                        } else {
                            ++current;
                            return next();
                        }
                    }

                    function finish() {

                        var timeEntries = {};

                        parsed.time_entries.forEach(function (timeEntry) {
                            if (!timeEntries[timeEntry.project.name]) {
                                timeEntries[timeEntry.project.name] = {};
                            }
                            var issueId = timeEntry.issue ? timeEntry.issue.id : -1;
                            if (!timeEntries[timeEntry.project.name][issueId]) {
                                timeEntries[timeEntry.project.name][issueId] = [];
                            }
                            timeEntries[timeEntry.project.name][issueId].push(timeEntry.comments);
                        });

                        for (var i in timeEntries) {
                            description += "h1. " + i + "\n\n";
                            if(timeEntries[i][-1]) {
                                addIssueTimeEntries(i, -1);
                            }
                            for (var j in timeEntries[i]) {
                                if(j === -1) {
                                    continue;
                                }
                                addIssueTimeEntries(i, j);
                            }
                            function addIssueTimeEntries(projectId, entryId) {
                                if(issues[entryId]) {
                                    description += "* _" + issues[entryId].replace(/([A-Z]+-\d+)(\s)/, "*$1*$2") + "_\n";
                                } else {
                                    description += "* _без задачи_\n";
                                }
                                timeEntries[projectId][entryId].forEach(function (comments) {
                                    description += "** " + comments.replace(/^\*\s/, "").replace(/\s+\*/g, "\n**") + "\n";
                                });
                            }
                            description += "\n";
                        }

                        if (description) {

                            news["news[description]"] = description;

                            http.request({
                                hostname: host,
                                path: "/projects/" + options.redmine.project + "/news",
                                headers: {
                                    Cookie: options.redmine.cookie
                                }
                            }, function (res) {

                                var newsPage = "";
                                res.on("data", function (chunk) {
                                    newsPage += chunk;
                                });
                                res.on("end", function () {

                                    var tokenTokes = getToken(newsPage);

                                    if (!tokenTokes) {
                                        throw new Error("can't get CSRF token");
                                    }

                                    news.authenticity_token = tokenTokes[1];

                                    console.log(news.authenticity_token);

                                    var form = new formData();
                                    for (var i in news) {
                                        form.append(i, news[i]);
                                    }

                                    form.submit({
                                        host: host,
                                        path: "/projects/" + options.redmine.report.project + "/news",
                                        method: "POST",
                                        headers: {
                                            'Cookie': options.redmine.cookie
                                        }
                                    }, function (err, res) {
                                        var data = "";
                                        //console.log(res.headers);
                                        res.on("data", function (chunk) {
                                            data += chunk;
                                        });
                                        res.on("end", function () {
                                            var error = data.match(/<p\s+id="errorExplanation">(.*?).<\/p>/);
                                            if (error) {
                                                var token = getToken(data);
                                                if (token) {
                                                    console.log(token[1]);
                                                }
                                                console.error(error[1]);
                                            } else {
                                                console.log(data);
                                            }
                                            resolve();
                                        });
                                    });
                                });

                            }).end();

                        } else {
                            resolve();
                        }


                    }


                });
            });

            req.end();

        });

    }

};