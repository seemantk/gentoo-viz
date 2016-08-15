var margin = {top: 30, right: 20, bottom: 40, left: 50},
    theight = 81,  // tardis height
    tmargtop = 20,
    tmargin = 30,
    width = 960 - margin.left - margin.right,
    height = 500 - margin.top - margin.bottom;

var runtime = 132 * 1000; // 132 seconds total run time

var dev,
    hrinfo = [];

var columns = ['shape', 'status'];

// Date-time formatter: YYYYMM is the format in the data file.
var titleDate = d3.time.format("%b %Y"),
    ldapDate  = d3.time.format("%Y/%m/%d")
    monthDate = d3.time.format("%Y%m");
    

/*
 * Scales and Axes
 */
// Positional in x and y.
var x0 = d3.scale.ordinal().domain([0]).range([margin.left * 2]),
    x = d3.scale.log()
        .range([margin.left * 2.5, width - margin.right])
        .clamp(true);

function xScale(d) { return d > 0 ? x(d) : x0(d); }

var x0Axis = d3.svg.axis().scale(x0).orient("bottom"),
    xAxis = d3.svg.axis()
            .scale(x)
            .ticks(16, d3.format("s"))
            .tickSize(8,0)
            .orient("bottom");



var y0 = d3.scale.ordinal().domain([0]).range([height - (margin.bottom)]),
    y = d3.scale.log()
        .range([height - (margin.bottom * 2), margin.top])
        .clamp(true);

function yScale(d) { return d > 0 ? y(d) : y0(d); }

var y0Axis = d3.svg.axis().scale(y0).orient("left"),
    yAxis = d3.svg.axis()
            .scale(y)
            .ticks(16, d3.format("s"))
            .tickSize(6,0)
            .orient("left");


// Radii and Areas
var r = d3.scale.ordinal()
        .domain(["developer", "recruit", "retired"])
        .range([4,3,2]);

function rScale(d) { return 2 * Math.sqrt(d); }

// Color scale
var fillColor = d3.scale.ordinal()
            .domain(["developer", "recruit", "retired"])
                .range(["#34349c", "#044404", "#7d0a0a"]);

queue()
    .defer(d3.tsv, "data/developers.tsv", function(d) {
        return {
            alias    : d.alias,
            nick     : d.developer,
            fullname : d.fullname,
            join     : ldapDate.parse(d.join),
            retire   : ldapDate.parse(d.retire),
        };
    })
    .defer(d3.csv, "data/activity.csv", function(d) {
        return {
            date          : d.date,
            nick          : d.developer,
            hr            : d.hr,
            bugs          : +d.bugs,
            commits       : +d.commits,
            total_bugs    : +d.total_bugs,
            total_commits : +d.total_commits,
        };
    })
    .await(galactify);

function galactify(error, developers, gentoo) {
    var rollcall = d3.nest()
                    .key(function(d) { return d.nick; })
                    .map(developers, d3.map);

    // Check if a dev was specified
    dev = rollcall.get(getParameterByName("dev"));
    dev = dev ? dev[0] : null;

    if(dev) {
        d3.select("h1")
            .text(d3.select("h1").text() + " for " + dev.fullname);
    }

    // Activity by developer
    var bydev = d3.nest()
                .key(function(d) { return d.nick; })
                .sortValues(function(a, b) {
                    // Sort their activities by descending date so that
                    // the most recent one is in front.  This will be handy
                    // for warping later.
                    return d3.descending(+a.date, +b.date);
                })
                .map(gentoo, d3.map);

    // Activity dates
    var months = d3.nest()
                    .key(function(d) { return d.date; })
                    .map(gentoo, d3.map)
                    .keys().sort(function(a, b) {
                        return d3.ascending(+a, +b);
                    });

    var layers = d3.layout.stack()
                    .offset("wiggle")
                    .values(function(d) { return d.values; })
                (dev ? devStream() : projStream()); // apply layout to proj or dev

    // Seismograph axes
    var validtime = d3.time.scale()
                .domain([
                    monthDate.parse(months[0]),
                    monthDate.parse(months[months.length - 1])
                ])
                .clamp(true);

    var xseis = d3.time.scale()
                .domain([
                    d3.time.year.floor(validtime.domain()[0]),
                    d3.time.year.ceil(validtime.domain()[1])
                ])
                .range([0, width])
                .clamp(true);

    validtime.range([xseis(validtime.domain()[0]),xseis(validtime.domain()[1])]);


    var yseis = d3.scale.linear()
                .domain([
                    0,
                    d3.max(layers.map(function(l) {
                        return d3.max(l.values, function(v) {return v.y + v.y0;});
                    }))
                ])
                .range([theight - tmargin, 0]);

    // Add a time axis to the seismograph
    var tAxis = d3.svg.axis()
                .scale(xseis)
                .ticks(d3.time.years, 1)
                .tickFormat(d3.time.format('%Y'))
                .tickSize(0, 8, 0)
                .tickPadding(8)
                .orient("bottom");

    // The seismograph itself
    var area = d3.svg.area()
        .x(function(d) { return xseis(monthDate.parse(d.x)); })
        .y0(function(d) { return yseis(d.y0); })
        .y1(function(d) { return yseis(d.y0 + d.y); })
        .interpolate('monotone');

    var brush = d3.svg.brush()
                .x(xseis)
                .extent([monthDate.parse(months[0]), monthDate.parse(months[1])])
                .on("brush", brushmove);

    // Setup the animation parameters
    var anim = {
            fwd: true,
            pause: false,
            index: months[0], // default starting/current point
            dest: months[months-1], // default destination
            cycle: runtime / months.length, //duration of each animation frame
    };

    // The data maps to the x and y axes:
    x.domain([1, d3.max(gentoo.map(function(d) { return d.total_commits; }))]);
    y.domain([1, d3.max(gentoo.map(function(d) { return d.total_bugs; }))]);


    /*
     * DRAWING
     */
    var div = d3.select("body").append("div")   
            .attr("class", "tooltip")               
            .style("opacity", 0);

    /*
     * The timey-wimey controller is all the way up top.
     * Populate the list of years in the domain, and a list of the months of
     * the year.
     */
    
    var tardis = d3.select("#tardis").append("svg")
                    .attr("width", width)
                    .attr("height", theight + tmargtop);

    var streams = tardis.append("g")
        .attr("class", "streams");


    if(dev) {
        var data = [];
        hrinfo.forEach(function(d, i) {
            var start = months.indexOf(d.date);

            data.push({
                offset: percentage(start, months.length),
                hr: hrinfo[i].hr
            });

            if(hrinfo[i+1]) {
                data.push({
                    offset: percentage(months.indexOf(hrinfo[i+1].date),
                                months.length),
                    hr: d.hr
                });
            }
        });

        streams.append("linearGradient")
            .attr("id", "bugs-gradient")
            .attr("gradientUnits", "userSpaceOnUse")
            .attr("x1", "0%")
            .attr("y1", "0%")
            .attr("x2", "100%")
            .attr("y2", "0%")
          .selectAll("stop")
            .data(data)
            .enter().append("stop")
            .attr("offset", function(d) { return d.offset; })
            .attr("class", function(d) { return "bugs" + d.hr; });

        streams.append("linearGradient")
            .attr("id", "commits-gradient")
            .attr("gradientUnits", "userSpaceOnUse")
            .attr("x1", "0%")
            .attr("y1", "0%")
            .attr("x2", "100%")
            .attr("y2", "0%")
          .selectAll("stop")
            .data(data)
          .enter().append("stop")
            .attr("offset", function(d) { return d.offset; })
            .attr("class", function(d) { return "commits" + d.hr; });
    } // if(dev)

    var path = streams.selectAll("path")
        .data(layers)
      .enter().append("path");

        path.attr("class", function(d) { return d.name; })
            .attr("d", function(d) { return area(d.values); });

      if(dev) {
        path.style("fill", function(d) {return "url(#" + d.name + "-gradient)";});
      }

    var t_axis = tardis.append("g")
        .attr("class", "t-axis")
        .attr("transform", "translate(0," + (theight + tmargtop - tmargin) + ")")
        .call(tAxis);

    // Make the year labels clickable
    t_axis.selectAll(".tick").select("text")
        .attr("transform", "translate(" +
            (xseis(monthDate.parse(months[5])) -
             xseis(monthDate.parse(months[0]))) +
            ",0)")
        .style("cursor", "pointer")
        .style("text-anchor", "middle")
        .on("click", function(d) {
            // Normalize this to the domain, in case the click was outside
            var index = d.getFullYear() + anim.index.slice(-2);
            anim.index = monthDate(validtime.invert(validtime(
                                        monthDate.parse(index))));
            draw()
            anim.pause = true;
        });


    var slider = tardis.append("g")
        .attr("class", "brush")
        .call(brush);

    slider.selectAll(".resize").remove();
    slider.selectAll("rect")
        .attr("height", theight - tmargin - 2);
    slider.select(".background")
        .attr("height", theight);

    slider.append("text")
        .attr("class", "monthText")
        .attr("transform", "translate(0," + (tmargin + 2 * tmargtop) + ")");
    /*
     * DRAWING
     * The Main graph is right below the time-wimey controller.
     *
     */
    /*
     * Step 1: Put an SVG into the div
     */
    var graph = d3.select("#viz").append("svg")
            .attr("class", "graph")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
          .append("g");

    var x_axis = graph.append("g")
        .attr("transform", "translate(0," + height + ")")
        .attr("class", "x-axis");

    x_axis.append("g")
        .attr("class", "x axis")
        .call(xAxis);

    x_axis.append("g")
        .attr("class", "xzero axis")
        .call(x0Axis);

    x_axis.selectAll("text")
        .attr("y", 20)
        .attr("x", 9)
        .attr("dy", ".35em")
        .style("text-anchor", "middle");

    graph.append("text")
        .attr("class", "x label")
        .attr("x", width/2)
        .attr("y", height - (margin.bottom*1/3))
        .style("text-anchor", "end")
        .text("commits");

    var y_axis = graph.append("g")
        .attr("transform", "translate(" + margin.left + ",0)")
        .attr("class", "y-axis");

    y_axis.append("g")
        .attr("class", "y axis")
        .call(yAxis);

    y_axis.append("g")
        .attr("class", "yzero axis")
        .call(y0Axis);

    graph.append("text")
        .attr("class", "y label")
        .attr("transform", "translate(" + (margin.left*1.5) + "," + (height/2) +
            ") rotate(-90)")
        .style("text-anchor", "middle")
        .text("bugs RESOLVED");

    var rows = d3.select("#legend").select("tbody").selectAll("tr")
                    .data(fillColor.domain())
                  .enter().append("tr");

    var cells = rows.selectAll("td")
                    .data(function(row) {
                        return columns.map(function(col) {
                            return [col, row];
                        });
                    })
                  .enter().append("td");

    cells.filter(function(d) { return d[0] === "shape"; })
        .append("svg")
        .attr("height", 20)
        .attr("width", 20)
        .attr("transform", "translate(0,0)")
      .append("circle")
        .attr("cx", 10)
        .attr("cy", 10)
        .attr("r", function(d) {
            return d === "joinpart" ? "retired" : rScale(r(d[1])); })
        .attr("class", function(d) { return d[1]; });

    cells.filter(function(d) { return d[0] !== "shape"; })
        .attr("class", "text-left")
        .text(function(d) { return d[1]; });


    d3.select("#pause").on("click", function() {
        anim.pause = !anim.pause;
        draw();
    });
    d3.select("#play").on("click", function() {
        anim.fwd = true;
        if(anim.pause) {
            anim.pause = false;
            d3.timer(step, anim.cycle);
        }
    });
    d3.select("#yalp").on("click", function() {
        anim.fwd = false;
        if(anim.pause) {
            anim.pause = false;
            d3.timer(step, anim.cycle);
        }
    });

    // PRE-MAIN
    if(dev) {
        var tens = tenureToString(rollcall.get(dev.nick)).split(" to ");
        dest = tens[tens.length - 1];

        anim.dest = dest === "present" ?
            months[months.length - 1] : monthDate(titleDate.parse(dest));

        anim.index = hrinfo[0].date;
    }// if(dev)

    // MAIN
    d3.timer(step, anim.cycle);

    /*
     * CALLBACKS
     */
    // Step forward to the next month (this is a callback function for d3.timer)
    function step() {
        if(anim.pause) return true;

        if(anim.index === anim.dest) {
            anim.pause = true;
            anim.dest = anim.fwd? months[months.length - 1] : months[0];
            return true;
        }

        // Otherwise, draw the current index
        draw();

        // Advance to the next month
        var index = months.indexOf(anim.index);

        if(anim.fwd) {
            index++;
            if(index > months.length - 1) {
                index = 0;
                anim.pause = true;
                return true;
            }
        } else {  // anim.fwd === false
            index--;
            if(index < 0) {
                index = months.length - 2;
                anim.pause = true;
                return true;
            }
        }
        anim.index = months[index];
        d3.timer(step, anim.cycle);
        return true;
    }; // step()

    //Brush callback
    function brushmove() {
        if(d3.event.sourceEvent) { // not a programmatic event -- the mouse or tap
            var tapped = monthDate(validtime.invert(d3.mouse(this)[0]));
            anim.fwd = anim.index < tapped;
            anim.index = tapped;
            anim.pause = true;
        }
        draw();
    }; // brushmove()



    /*
     * METHODS
     */
    // Draw the current frame (as defined by the value of anim.index)
    function draw() {
        // Retrieve the most recent activity for all developers with respect
        // to the destination date.
        var data = bydev.values().map(function(b) { return warpDev(b); })
                .filter(function(d) { return d !== undefined; });

        var circle = d3.select(".graph").selectAll("circle")
            .data(data, function(d) { return d.nick; });

        // Remove circles that are not going to warp
        if(anim.fwd) {
            circle.exit().transition().duration(anim.cycle)
                .style("opacity", function(d) {
                    return dev && (d.nick === dev.nick) ? 1 : .2;
                });
        } else {
            circle.exit().transition().duration(anim.cycle)
                .attr("r", 0)
                .remove();
        }

        // Insert new circles and hide them.
        circle.enter().append("circle")
            .attr("cx", function(d) { return xScale(d.total_commits); })
            .attr("cy", function(d) { return yScale(d.total_bugs); })
            .attr("r", 0)
            .attr("class", function(d) {
                return d.hr + (d.date === anim.index ? " active" : " inactive");
            })
            .attr("id", function(d) {
                return dev && (d.nick === dev.nick) ? "you" : null;
            })
            .on("mouseover", function(d) {
                div.transition().duration(200)
                    .style("opacity", .9);
                div.html(devTooltip(d))
                    .style("left", (d3.event.pageX) + "px")
                    .style("top", (d3.event.pageY - 28) + "px");
            })
            .on("mouseout", function(d) { 
                div.transition().duration(500)
                    .style("opacity", 1e-6);
            })
            ;

        // Slide circles into place and twinkle to:
        // Size, Color, Visibility
        circle.transition().duration(anim.cycle / 2)
            .each("start", function() {
                d3.select(this).node().parentNode.appendChild(this);
            })
            .each("start", function() {
                if(d3.select(this).attr("id") === "you")
                    d3.select(this).node().parentNode.appendChild(this);
            })
            .attr("cx", function(d) { return xScale(d.total_commits); })
            .attr("cy", function(d) { return yScale(d.total_bugs); })
            .style("opacity", function(d) {
                return d.date === anim.index
                        ? 1 : dev && (d.nick === dev.nick)
                            ? 1 : 0.2; // anim.pause ? 0.2 : 1e-6;
            })
        .transition().delay(anim.cycle / 2)
            .duration(anim.cycle / 2)
            .attr("r", function(d) {
                return rScale(r(d.hr === "joinpart" ?  "retired" : d.hr)); })
            .attr("class", function(d) {
                return d.hr + (d.date === anim.index ? " active" : " inactive");
            });


        // Update the year display
        d3.select(".t-axis").selectAll(".tick").select("text")
            .attr("class", function(d) {
                return d.getFullYear() === +anim.index.slice(0,4) ?
                    "current" : "notcurrent";
            });

        // Update the month display
        var index = months.indexOf(anim.index);
        index = index < 0
                ? 0 : index > months.length - 2
                    ? months.length - 2 : index;

        var monthName = d3.time.format("%b");
        d3.select(".monthText").transition().duration(anim.cycle)
            .attr("x", xseis(monthDate.parse(months[index])))
            .text(monthName(monthDate.parse(anim.index)));

        // Move the handle/slider
        slider.transition().duration(anim.cycle)
            .ease("linear")
            .call(brush.extent([
                monthDate.parse(months[index]), monthDate.parse(months[index + 1])
            ]));


    } // draw()

    
    /*
     * Get historical data for the date specified by anim.index
     */
    function warpDev(developer) {
        var acts = developer
                    .filter(function(d) { return +d.date <= +anim.index; });

        if(acts.length > 1) {
            var hr = acts.filter(function(a) { return a.hr !== ""; });
            if(hr.length > 0)
                acts[0].hr = hr[0].hr;

            return acts[0];
        }
    }; // warpDev()



    function devTooltip(d) {
        var roll = rollcall.get(d.nick);
        var tdat = titleDate(monthDate.parse(anim.index));

        return roll[0].fullname + " " +
            "(" + d.nick + (roll[0].alias? "/" + roll[0].alias : "") + ")<br/>" +
            "Tenure: " + tenureToString(roll) + "<br/>" +
            "Bugs (" + tdat + "): " + d.total_bugs + "<br/>" +
            "Commits (" + tdat + "): " + d.total_commits + "<br/>";
    };

    function tenureToString(d) {
        return d3.zip(
                d.map(function(t) { return t.join; }),
                d.map(function(t) { return t.retire; })
            ).map(function(t) {
                return titleDate(t[0]) + " to " +
                    (t[1] == null ? "present" : titleDate(t[1]));
            }).join(" and ");
    };

    function devStream() {
        var data = bydev.get(dev.nick)
                .sort(function(a, b) { return d3.descending(+a.date, +b.date); });

        /*
         * hrinfo is used for the color regions (recruit, developer, retired)
         * for the bugs and commits streams for the dev.
         */
        hrinfo.push(data[data.length-1]);

        for(var i = data.length - 1; i > 0; --i)
            if(data[i-1].hr !== data[i].hr)
                hrinfo.push(data[i-1]);

        var devacts = d3.nest().key(function(d) { return d.date; })
                    .map(bydev.get(dev.nick), d3.map);

        /*
         * Compute the dev's bugs and commits streams
         */
        months.map(function(m) {
            if(!devacts.has(+m))
                devacts.set(m, [{date: m, nick: dev.nick, bugs: 0, commits: 0}]);
        });
        
        return ["commits", "bugs"].map(function(a) {
            return {
                name: a,
                values: devacts.values()
                        .map(function(v) { return {x: v[0].date, y:v[0][a]}; })
                        .sort(function(a, b) { return d3.ascending(+a.x, +b.x); })
            };
        });
    } // devStream()

    function projStream() {
        var data = d3.nest()
                .key(function(d) {
                    return d.hr === "join"
                        ? "developer" : d.hr === "part" ? "retired": d.hr;
                })
                .key(function(d) { return d.date; })
                .rollup(function(leaves) {
                    return {x:leaves[0].date, y:leaves.length};
                })
                .map(gentoo, d3.map);


        data.get("joinpart").keys().forEach(function(date) {
            // add it to developer and retired
            var jp = data.get("joinpart").get(date);

            ["developer", "retired"].forEach(function(stat) {
                if(data.get(stat).has(date)) {
                    var orig = data.get(stat).get(date);
                    orig.y = orig.y + jp.y;
                    data.get(stat).set(date, orig);
                }
                else
                    data.get(stat).set(date, jp);
            });
        });

        data.remove("joinpart");
        data.get("retired").forEach(function(k,v) { v.y = -v.y; });

        return data.keys().sort().map(function(k) {
            months.map(function(m) {
                if(!data.get(k).has(m)) data.get(k).set(m, {x:m, y: 0});
            });

            return {
                name: k,
                values: data.get(k).values().sort(function(a, b) {
                    return d3.ascending(+a.x, +b.x); // x coordinate is date
                })
        }});
    } // projStream()

};

/*
 * FUNCTIONS
 */
// Capture URL query param
function getParameterByName(name) {
var match = RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return match && decodeURIComponent(
        match[1].replace(/\+/g, ' ').replace(/\//g, '')
    ).toLowerCase();
}

// Calculate percentage
function percentage(part, whole) {
    return (part / whole) * 100 + "%";
}
