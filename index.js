import { Client } from "@notionhq/client"
import { compareAsc, addBusinessDays, addWeeks, parse, getDay, formatISO, differenceInCalendarWeeks, set } from "date-fns";
import { RateLimiter } from "limiter-es6-compat";
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });

const notion = new Client({ auth: "" });
const databaseId = ""; //task database
const courseDatabase = ""; //course database
const cmdargs = process.argv.slice(2);
const amtOptionalArgs = checkArgs(cmdargs);

class Queue {
    constructor() {
        this.head = null;
        this.tail = null;
        this.length = 0;
    }

    append(item) {
        if(this.head == null) {
            this.head = {data: item, next: null};
            this.tail = this.head;
        } else {
            this.tail.next = {data: item, next: null};
            this.tail = this.tail.next;
        }
        this.length++;
    }

    shift() {
        if(this.head == null) {
            return null;
        } else {
            let result = this.head.data;
            if(this.head == this.tail) {
                this.head = null;
                this.tail = null;
            } else {
                this.head = this.head.next;
            }
            this.length--;
            return result;
        }
    }

    isEmpty() {
        return this.head == null;
    }

    print() {
        let ref = this.head;
        while(ref != this.tail) {
            console.log(ref.data);
            ref = ref.next;
        }
    }
};

const requestQueue = new Queue();

/*
 * time always in format HHMM, 0001-2400 
 * len - length in weeks
 * 
 *  lect format: le-135-10001050-13579-m-1
 *        days-time beginning to time end-weeks-mandatory/optional
 *  disc format: di-12345-10001050-0-m-1
 *  
 *  hwwk format: hw-15-1159-odd-m-1
 *         days-time-weeks between-mandatory/optional-startweek
 * 
 * -lect 135-10001050-0-m-1 -disc 1-1000-1050-0-m-1 -hmwk 1-1159-0-m-1
 * 
 * sample; 
 * 
 * weeks go from 0-9. have shorthands all and odd which mean 13579 and 0123456789 respectively.
 * 
 */

/*
 * Properties are passed in an container object.    
 * Valid Properties:
 * due_date; title; type; desc; class_id; topic_tag; chapter_tag; test_tag;
 * list of possible tags for a task: Class, Topic, Chapter, Test --> in initialization we can only set the class tag reasonably.
 */

const default_properties = {
    title: "",
    type: "",
    desc: "",
    date: "",
    topic_tag: "",
    chapter_tag: "",
    test_tag: "",
    attendance: true, //true is mandatory, false is optional
    completion: "not started",
}

const abbv = {
    "IP": "In Progress",
    "D": "Done",
    "NS": "Not Started",
    "le": "Lecture",
    "di": "Discussion",
    "la": "Lab",
    "hw": "Homework"
}

//checks for minimum amount of arguments for creating a course, class meeting, or homework.
function checkArgs(args) {
    if (args.length < 3 ) {
        console.log("please enter a command in the following format: \nnode index.js <type> <date of start> <length in weeks> <optional arguments>");
        process.exit();
    } else if (args.length >= 3) {
        return args.length - 3;
    }
}

function parseOptionalArgument(input) { //parse
    const args = input.split('-');
    if (args.length != 5 && args.length != 6) {
        console.error("Warning: parseSchedule got", args.length, "arguments, 5 or 6 expected");
        process.exit();
    } else if (args.length === 5) {
        args.push(abbv[args[0]]);
    }
    return args;
}

async function processQueue() { 
    const limiter = new RateLimiter({tokensPerInterval: 3, interval: 1000});
    var obj = {pending: 0};
    console.log("Checking Queue...");
    console.log(requestQueue.isEmpty())

    while(!requestQueue.isEmpty() || obj.pending > 0) {
        
        var remainingMessages = await limiter.removeTokens(1);
        if (!requestQueue.isEmpty()) {
            apiRequest(requestQueue.shift(), obj, requestQueue);
        } else {
            console.log("waiting...", obj.pending,"pending requests");
        }
        //request to add the item in the queue. 
        //if the request fails, add the item to the queue again. 
    }
}

async function apiRequest(task, tracker, requestQueue) {
    tracker.pending++;
    let result = await task.add();
    if (result.object === "error") {
        console.log(result.message);
        requestQueue.append(task);
    } else {
        console.log("success!", task.title, "added");
    }
    tracker.pending--;
}

async function createClass() { // days-time beginning to time end-weeks between-mandatory/optional-start week; default should be 1

    const name = await rl.question("Class Name: ");
    const status = await rl.question("Class Status (IP/D/NS): ");
    const quarter = await rl.question("Quarter Taken: ");
    rl.close();

    let new_class = new Course(name.toUpperCase(), abbv[status], quarter.toUpperCase());
    const result = await new_class.add();

    await iterateOptionalArguments(result, name);

}

async function iterateOptionalArguments(class_id, name) { // almost done, just make sure to add all relevant task tags to this done? needs testing.
    //remember to implement weeks.! Done. 
    //class_id ! not implemented yet. Done.

    for(let i = 0; i < amtOptionalArgs; i++) {
        let args = parseOptionalArgument(cmdargs[i+3]);
        let class_type = abbv[args[0]];
        let time = { start_hours: args[2].substring(0,2), start_mins: args[2].substring(2,4)};
        const it = makeWeekIterator(args[1], args[3], cmdargs[2], parse(cmdargs[1], 'MMddyyyy', new Date()));
        let result = it.next();
        while(!result.done) {
            //make database entries here.
            let properties = {
                title: name + " " + args[5] + " " + (result.iter + 1),
                type: class_type,
                date: set(result.value, {hours: time.start_hours, minutes: time.start_mins}),
                attendance: args[4] == "m",
                parent:class_id
            }
            switch(args[0]) { // implementation seems to be done?
                case "le":
                case "di":
                case "la":
                    time.end_hours = args[2].substring(4, 6);
                    time.end_mins = args[2].substring(6);
                    //title, desc (empty for now), type, date, parent, tags (empty, we changed the intended implementation), attendance, end_date
                    properties.end_date = set(result.value, {hours: time.end_hours, minutes: time.end_mins});
                    requestQueue.append(new Event(properties));
                    // add Event Object Here.
                    break;
                case "hw":
                    requestQueue.append(new Work(properties));
                    // add work object here.
                    break;
            }
            console.log(result.value); 
            result = it.next();
        }

        console.log("Iterated:", result.value, "times");
    }
}

function makeWeekIterator(day_string, week_string, weeks, start_date) { //start_date should be a date object. //done. needs testing.
    const days = day_string.split('');
    let meet_weeks = week_string.split('');
    if (week_string === "all") {
        meet_weeks = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    } else if (week_string === "odd") {
        meet_weeks = ["1", "3", "5", "7", "9"];
    }
    console.log(meet_weeks);

    const end_date = addWeeks(start_date, weeks);

    let next_day = start_date;
    while (!days.includes(getDay(next_day).toString()) || !meet_weeks.includes( (differenceInCalendarWeeks(next_day, start_date)).toString() )) {
        next_day = addBusinessDays(next_day, 1);
    }
    
    let iteration_count = 0;

    const weekIterator = {
        next() {
            let result;
            if(compareAsc(next_day, end_date) <= 0) {
                result = { value: next_day, done: false, iter: iteration_count};
                next_day = addBusinessDays(next_day, 1);
                iteration_count++;
                while (  (!days.includes( getDay(next_day).toString() ) || 
                                          !meet_weeks.includes( (differenceInCalendarWeeks(next_day, start_date)).toString())) && 
                                          (compareAsc(next_day, end_date) != 1) ) {
                    next_day = addBusinessDays(next_day, 1);  
                } // KEEP ITERATING IF THE CURRENT DAY IS NOT IN THE DAY LIST OR THE CURRENT WEEK IS NOT IN THE WEEK LIST. HOWEVER, IF THE DAY IS AFTER THE END OF THE SEMESTER, STOP
                console.log(result.value);
                return result;
            }
            return { value: iteration_count, done: true, iter: iteration_count };
        }
    }
    return weekIterator;
}

class Course {
    constructor(name, status, quarter) {
        this.name = name;
        this.status = status;
        if (status == null) {
            status = "Not Started";
        }
        this.quarter = quarter;
        this.department = this.name.split(" ")[0];
    }

    async add() {
        try {
            const response = await notion.pages.create({
                "parent": { "database_id": courseDatabase },
                "properties": {
                    "Course": {
                        "title": [
                            {
                                "text": {
                                    "content": this.name
                                }
                            }
                        ]
                    },
                    "Department": {
                        "select": {
                            "name": this.department
                        }
                    }, 
                    "Quarter": {
                        "select": {
                            "name": this.quarter
                        }
                    }, 
                    "Status": {
                        "status": {
                            "name": this.status
                        }
                    }
                }
            });
            console.log("Class",this.name,"successfully added");
            return response.id;
        } catch (error) {
            return error.body;
        }
    }

    async update() {
        return;
    }
}

class Task { //both Events and Tasks have their add method implemented. They have yet to be tested. Note: Events requires two extra properties, attendance and end_date.
    constructor(properties) {
        this.title = properties.title || default_properties.title;
        this.type = properties.type || default_properties.type;
        this.desc = properties.desc || default_properties.desc;
        this.date = properties.date || default_properties.date; //Tasks should always have a date AND time associated with them. 
        this.parent = properties.parent; // properties should always have a parent. There should never be a situation where a task doesn't have a parent class associated with it.
        this.tags = [ {"name":this.title} ];
    }

}

class Event extends Task { 
    constructor(properties) {
        super(properties)
        this.attendnance = properties.attendance || default_properties.attendance;
        this.end_date = properties.end_date || "";

    }

    async add() {
        try {
            const response = await notion.pages.create({
                "parent": { "database_id": databaseId },
                "properties": {
                    "Name": {
                        "title": [
                            {
                                "text": {
                                    "content": this.title
                                }
                            }
                        ]
                    },
                    "Date": {
                        "date": {
                            "start": formatISO(this.date),
                            "end": formatISO(this.end_date)
                        }
                    },
                    "Course": {
                        "relation": [
                            {
                                "id": this.parent
                            }
                        ]
                    },
                    "Mandatory": {
                        "status": {
                            "name": this.attendance ? "No" : "Yes"
                        }
                    },
                    "Type": {
                        "select": {
                            "name": this.type
                        }
                    }
                }
            });
            return response;
        } catch (error) {
            return error.body;
        }
    }
}

class Work extends Task {
    constructor(properties) {
        super(properties);
    }

    async add() {
        try {
            const response = await notion.pages.create({
                "parent": { "database_id": databaseId },
                "properties": {
                    "Name": {
                        "title": [
                                {
                                    "text": {
                                        "content": this.title
                                    }
                                }
                            ]
                    },
                    "Date": {
                        "date": {
                            "start": formatISO(this.date),
                        }
                    },
                    "Course": {
                        "relation": [
                            {
                                "id": this.parent
                            }
                        ]
                    },
                    "Type": {
                        "select": {
                            "name": this.type
                        }
                    }
                }
            });
            return response;
        } catch(error) {
            return error.body;
        }
    }
}

async function main() {
    switch(cmdargs[0]) {
        case "course":
            await createClass();
            break;

        case "di":
        case "le":
        case "la":
            //await addMeeting();
            break;

        case "hw":
            //await addHomework();
            break;

        case "edit":
           // await edit(options);
            break;
        case "task":
           // await addTask();
            break;
        default:
            console.log("Unexpected first argument. We were expecting something different.");
            process.exit();

    }

    await processQueue();

    console.log("Complete!");
}

main();
