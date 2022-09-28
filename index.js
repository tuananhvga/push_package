const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');

const readline = require('readline');
const AdmZip = require('adm-zip');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const REQUIRED_WEBSITE_PARAMS = ["websiteName", "websitePushID", "allowedDomains", "urlFormatString", "authenticationToken", "webServiceURL"]
const REQUIRED_ICONSET_FILES = ["icon_16x16.png", "icon_16x16@2x.png", "icon_32x32.png", "icon_32x32@2x.png", "icon_128x128.png", "icon_128x128@2x.png"]

async function execCommand(command) {
    return new Promise((res, rej) => {
        child_process.exec(command, (err, stdout, stderr) => {
            if (err) {
                rej({
                    ...err,
                    stderr
                }
                );
            }
            res(stdout);
        });
    });
}

function getFileList(argv) {
    const files = REQUIRED_ICONSET_FILES.map(name => {
        return {
            path: path.join(argv.i, name),
            name: `icon.iconset/${name}`,
        }
    });
    files.push({
        path: argv.w,
        name: "website.json",
    });
    return files;
}

function createManifest(argv) {
    // create manifest.json
    const manifest = {};
    const files = getFileList(argv);
    for (const file of files) {
        const body = fs.readFileSync(file.path);
        const hashValue = crypto.createHash('sha512').update(body).digest('hex');
        manifest[file.name] = {
            hashType: 'sha512',
            hashValue,
        }
    }
    const manifestStr = JSON.stringify(manifest);
    fs.writeFileSync(path.join(__dirname, 'manifest.json'), manifestStr, {
        flag: 'w'
    });
    return manifestStr;
}

async function createSignature(argv, password) {
    await execCommand(`openssl pkcs12 -in ${argv.c} -out sign.crt.pem -nokeys -passin pass:${password}`);
    await execCommand(`openssl pkcs12 -in ${argv.c} -out sign.key.pem -nocerts -nodes -passin pass:${password}`);
    await execCommand(`openssl smime -sign -signer sign.crt.pem -inkey sign.key.pem -certfile ${argv.z} -binary -outform der -in manifest.json -out signature`);
}

function createZipPackage(argv){
    const zip = new AdmZip();
    zip.addLocalFolder(argv.i, 'icon.iconset');
    zip.addLocalFile('manifest.json');
    zip.addLocalFile('website.json');
    zip.addLocalFile('signature');

    zip.writeZip('pushPackage.zip');
}

async function processZip(argv, password) {
    let ok = true;

    let websiteJson = {};
    try {
        websiteJson = JSON.parse(fs.readFileSync(argv.w).toString());
        for (const field of REQUIRED_WEBSITE_PARAMS) {
            if (!(websiteJson[field]?.length > 0)) {
                console.log(`Field ${field} of website.json is required`);
                ok = false;
            }
        }
    } catch (ex) {
        console.log("Invalid website.json file");
        ok = false;
    }

    for (const fileName of REQUIRED_ICONSET_FILES) {
        const filePath = path.join(__dirname, argv.i, fileName);
        if (!fs.existsSync(filePath)) {
            console.log(`Icon file in path ${filePath} not found`);
            ok = false;
        }
    }

    createManifest(argv);
    try {
        await createSignature(argv, password);
        createZipPackage(argv);
    } catch (ex) {
        console.log(ex);
        process.exit(1);
    }

    process.exit(0);
}

var argv = require('yargs/yargs')(process.argv.slice(2))
    .usage('Usage: $0 [options]')
    .option('w', {
        alias: 'website-json',
        description: 'The path to website.json file',
        default: 'website.json',
    })
    .option('i', {
        alias: 'icon-set',
        description: 'The path to the iconset directory',
        default: 'icon.iconset',
    })
    .option('c', {
        alias: 'certificate',
        description: 'The path to the p12 file will be used for signing manifest.json',
    })
    .option('p', {
        alias: 'password',
        boolean: true,
        description: 'Input the password to stdin if any',
        default: false,
    })
    .option('z', {
        alias: 'intermediate-certificate',
        description: 'The path to the Apple WWDR Intermediate Certificate (.crt file)',
    })
    .option('o', {
        alias: 'output-dir',
        description: 'The output path for pushPackage.zip',
        default: '.'
    })
    .demandOption(['c','z'])
    .help()
    .argv;

if (argv.p) {
    rl.question('Input certificate password: ', (pw) => {
        processZip(argv, pw);
    });
} else {
    processZip(argv);
}
