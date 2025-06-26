import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { getBotmakerAllowedLoreBooks, isBotmaker } from '../../botmaker-config.js';


/**
*Gets user handle from request using SillyTavern's user system*
*/
function getUserHandleFromRequest(req) {
    // SillyTavern populates request.user via setUserDataMiddleware
    if (req.user && req.user.profile && req.user.profile.handle) {
        return req.user.profile.handle;
    }

    // Fallback to default user if no user accounts are enabled
    return 'default-user';
}

/**
 *Checks if user is admin using SillyTavern's user system*
*/
function checkIfUserIsAdmin(req) {
    if (req.user && req.user.profile) {
        // Check if user has admin flag (if your system uses this)
        if (req.user.profile.admin === true) {
            return true;
        }

        // Check specific admin handles
        const adminHandles = ['admin', 'default-user'];
        return adminHandles.includes(req.user.profile.handle);
    }

    return false;
}

/**
*Checks if user is a botmaker*
*/
function checkIfUserIsBotmaker(req) {
    const userHandle = getUserHandleFromRequest(req);
    return isBotmaker(userHandle);
}

/**
*Checks if user has access to a specific lorebook*
*/
function hasLoreBookAccessPermission(req, lorebookName, requiresWrite = false) {
    const userHandle = getUserHandleFromRequest(req);
    const isAdmin = checkIfUserIsAdmin(req);
    const isBotmaker = checkIfUserIsBotmaker(req);

    console.log(`[RBAC] Checking access for user: ${userHandle}, lorebook: ${lorebookName}, requiresWrite: ${requiresWrite}`);

    // Admins have full access
    if (isAdmin) {
        console.log(`[RBAC] Admin access granted for ${userHandle}`);
        return true;
    }

    // Hidden files are admin-only
    if (lorebookName.includes('#hidden#')) {
        console.log(`[RBAC] Hidden file access denied for ${userHandle}`);
        return false;
    }

    // Personal loreBooks: match username prefix
    if (lorebookName.startsWith(`$$-${userHandle}-`)) {
        console.log(`[RBAC] Personal lorebook access granted for ${userHandle}`);
        return true;
    }

    // Global loreBooks: available to everyone (no $$- prefix)
    if (!lorebookName.startsWith('$$-')) {
        console.log(`[RBAC] Global lorebook access granted for ${userHandle}`);
        return true;
    }

    // Botmaker loreBooks: check permissions
    if (isBotmaker) {
        const allowedBooks = getBotmakerAllowedLoreBooks(req);
        const hasAccess = allowedBooks.includes(lorebookName);

        if (hasAccess) {
            console.log(`[RBAC] Botmaker access granted for ${userHandle} to ${lorebookName}`);
            return true;
        } else {
            console.log(`[RBAC] Botmaker access denied for ${userHandle} to ${lorebookName} - not in allowed list`);
            return false;
        }
    }

    // Default deny for user-specific loreBooks
    console.log(`[RBAC] Default access denied for ${userHandle} to ${lorebookName}`);
    return false;
}


/**
 * Reads a World Info file and returns its contents
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} worldInfoName Name of the World Info file
 * @param {boolean} allowDummy If true, returns an empty object if the file doesn't exist
 * @returns {object} World Info file contents
 */
export function readWorldInfoFile(directories, worldInfoName, allowDummy) {
    const dummyObject = allowDummy ? { entries: {} } : null;

    if (!worldInfoName) {
        return dummyObject;
    }

    const filename = `${worldInfoName}.json`;
    const pathToWorldInfo = path.join(directories.worlds, filename);

    if (!fs.existsSync(pathToWorldInfo)) {
        console.error(`World info file ${filename} doesn't exist.`);
        return dummyObject;
    }

    const worldInfoText = fs.readFileSync(pathToWorldInfo, 'utf8');
    const worldInfo = JSON.parse(worldInfoText);
    return worldInfo;
}

export const router = express.Router();

// Add this endpoint
router.get('/user-permissions', (request, response) => {
    const userHandle = getUserHandleFromRequest(request);

    return response.json({
        isBotmaker: isBotmaker(userHandle),
        allowedBooks: getBotmakerAllowedLoreBooks(userHandle),
        userHandle: userHandle
    });
});


router.post('/get', (request, response) => {
    if (!request.body?.name) {
        return response.sendStatus(400);
    }

    const lorebookName = request.body.name;

    // Check permissions
    if (!hasLoreBookAccessPermission(request, lorebookName, false)) {
        return response.status(403).json({
            error: 'Access denied',
            message: 'You do not have permission to access this lorebook'
        });
    }

    const file = readWorldInfoFile(request.user.directories, lorebookName, true);

    return response.send(file);
});


router.post('/delete', (request, response) => {
    if (!request.body?.name) {
        return response.sendStatus(400);
    }

    const worldInfoName = request.body.name;

    // Check permissions - delete requires write access
    if (!hasLoreBookAccessPermission(request, worldInfoName, true)) {
        return response.status(403).json({
            error: 'Access denied',
            message: 'You do not have permission to delete this lorebook'
        });
    }

    const filename = sanitize(`${worldInfoName}.json`);
    const pathToWorldInfo = path.join(request.user.directories.worlds, filename);

    if (!fs.existsSync(pathToWorldInfo)) {
        throw new Error(`World info file ${filename} doesn't exist.`);
    }

    fs.unlinkSync(pathToWorldInfo);

    return response.sendStatus(200);
});


router.post('/import', (request, response) => {
    if (!request.file) return response.sendStatus(400);

    const filename = `${path.parse(sanitize(request.file.originalname)).name}.json`;
    const worldName = path.parse(filename).name;

    // Check if user can create this lorebook based on naming conventions
    const userHandle = getUserHandleFromRequest(request);
    const isAdmin = checkIfUserIsAdmin(request);

    // If it's a user-specific lorebook (starts with $$-), check permissions
    if (worldName.startsWith('$$-') && !worldName.startsWith(`$$-${userHandle}-`) && !isAdmin) {
        return response.status(403).json({
            error: 'Access denied',
            message: 'You can only import lorebooks with your own username prefix'
        });
    }

    let fileContents = null;

    if (request.body.convertedData) {
        fileContents = request.body.convertedData;
    } else {
        const pathToUpload = path.join(request.file.destination, request.file.filename);
        fileContents = fs.readFileSync(pathToUpload, 'utf8');
        fs.unlinkSync(pathToUpload);
    }

    try {
        const worldContent = JSON.parse(fileContents);
        if (!('entries' in worldContent)) {
            throw new Error('File must contain a world info entries list');
        }
    } catch (err) {
        return response.status(400).send('Is not a valid world info file');
    }

    const pathToNewFile = path.join(request.user.directories.worlds, filename);

    if (!worldName) {
        return response.status(400).send('World file must have a name');
    }

    writeFileAtomicSync(pathToNewFile, fileContents);
    return response.send({ name: worldName });
});

router.post('/edit', (request, response) => {
    if (!request.body) {
        return response.sendStatus(400);
    }

    if (!request.body.name) {
        return response.status(400).send('World file must have a name');
    }

    const lorebookName = request.body.name;

    // Check permissions - edit requires write access
    if (!hasLoreBookAccessPermission(request, lorebookName, true)) {
        return response.status(403).json({
            error: 'Access denied',
            message: 'You do not have permission to edit this lorebook'
        });
    }

    try {
        if (!('entries' in request.body.data)) {
            throw new Error('World info must contain an entries list');
        }
    } catch (err) {
        return response.status(400).send('Is not a valid world info file');
    }

    const filename = `${sanitize(lorebookName)}.json`;
    const pathToFile = path.join(request.user.directories.worlds, filename);

    let targetPath = pathToFile;
    try {
        const stats = fs.lstatSync(pathToFile);
        if (stats.isSymbolicLink()) {
            targetPath = fs.readlinkSync(pathToFile);
            console.log(`File ${pathToFile} is a symlink, writing to target: ${targetPath}`);
        }
    } catch (err) {
        console.error(`Error checking if ${pathToFile} is a symlink: ${err.message}`);
    }
    writeFileAtomicSync(targetPath, JSON.stringify(request.body.data, null, 4));

    return response.send({ ok: true });
});

