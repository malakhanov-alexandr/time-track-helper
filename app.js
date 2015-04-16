if (!process.argv || process.argv.length < 3) {
    throw new Exception("You should pass script name");
}

require("./scripts/" + process.argv[2] + ".js")();