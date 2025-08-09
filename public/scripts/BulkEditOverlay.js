'use strict';

import {
    characterGroupOverlay,
    characters,
    event_types,
    eventSource,
    getCharacters,
    getRequestHeaders,
    buildAvatarList,
    characterToEntity,
    printCharactersDebounced,
    deleteCharacter,
    bulkDelChat,
    bulkDeleteCharacterChatsByName,
    this_chid,
    displayPastChats,
} from '../script.js';
import { selected_group } from './group-chats.js';

import { favsToHotswap } from './RossAscends-mods.js';
import { hideLoader, showLoader } from './loader.js';
import { convertCharacterToPersona } from './personas.js';
import { callGenericPopup, POPUP_TYPE } from './popup.js';
import { createTagInput, getTagKeyForEntity, getTagsList, printTagList, tag_map, compareTagsForSort, removeTagFromMap, importTags, tag_import_setting } from './tags.js';

/**
 * Static object representing the actions of the
 * character context menu override.
 */
class CharacterContextMenu {
    /**
     * Tag one or more characters,
     * opens a popup.
     *
     * @param {Array<number>} selectedCharacters
     */
    static tag = (selectedCharacters) => {
        characterGroupOverlay.bulkTagPopupHandler.show(selectedCharacters);
    };

    /**
     * Duplicate one or more characters
     *
     * @param {number} characterId
     * @returns {Promise<any>}
     */
    static duplicate = async (characterId) => {
        const character = CharacterContextMenu.#getCharacter(characterId);
        const body = { avatar_url: character.avatar };

        const result = await fetch('/api/characters/duplicate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(body),
        });

        if (!result.ok) {
            throw new Error('Character not duplicated');
        }

        const data = await result.json();
        await eventSource.emit(event_types.CHARACTER_DUPLICATED, { oldAvatar: body.avatar_url, newAvatar: data.path });
    };

    /**
     * Favorite a character
     * and highlight it.
     *
     * @param {number} characterId
     * @returns {Promise<void>}
     */
    static favorite = async (characterId) => {
        const character = CharacterContextMenu.#getCharacter(characterId);
        const newFavState = !character.data.extensions.fav;

        const data = {
            name: character.name,
            avatar: character.avatar,
            data: {
                extensions: {
                    fav: newFavState,
                },
            },
            fav: newFavState,
        };

        const mergeResponse = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(data),
        });

        if (!mergeResponse.ok) {
            mergeResponse.json().then(json => toastr.error(`Character not saved. Error: ${json.message}. Field: ${json.error}`));
        }

        const element = document.getElementById(`CharID${characterId}`);
        element.classList.toggle('is_fav');
    };

    /**
     * Convert one or more characters to persona,
     * may open a popup for one or more characters.
     *
     * @param {number} characterId
     * @returns {Promise<void>}
     */
    static persona = async (characterId) => await convertCharacterToPersona(characterId);

    /**
     * Delete one or more characters,
     * opens a popup.
     *
     * @param {string|string[]} characterKey
     * @param {boolean} [deleteChats]
     * @returns {Promise<void>}
     */
    static delete = async (characterKey, deleteChats = false) => {
        await deleteCharacter(characterKey, { deleteChats: deleteChats });
    };

    static #getCharacter = (characterId) => characters[characterId] ?? null;

    /**
     * Show the context menu at the given position
     *
     * @param positionX
     * @param positionY
     */
    static show = (positionX, positionY) => {
        let contextMenu = document.getElementById(BulkEditOverlay.contextMenuId);
        contextMenu.style.left = `${positionX}px`;
        contextMenu.style.top = `${positionY}px`;

        document.getElementById(BulkEditOverlay.contextMenuId).classList.remove('hidden');

        // Adjust position if context menu is outside of viewport
        const boundingRect = contextMenu.getBoundingClientRect();
        if (boundingRect.right > window.innerWidth) {
            contextMenu.style.left = `${positionX - (boundingRect.right - window.innerWidth)}px`;
        }
        if (boundingRect.bottom > window.innerHeight) {
            contextMenu.style.top = `${positionY - (boundingRect.bottom - window.innerHeight)}px`;
        }
    };

    /**
     * Hide the context menu
     */
    static hide = () => document.getElementById(BulkEditOverlay.contextMenuId).classList.add('hidden');

    /**
     * Sets up the context menu for the given overlay
     *
     * @param characterGroupOverlay
     */
    constructor(characterGroupOverlay) {
        const contextMenuItems = [
            { id: 'character_context_menu_favorite', callback: characterGroupOverlay.handleContextMenuFavorite },
            { id: 'character_context_menu_duplicate', callback: characterGroupOverlay.handleContextMenuDuplicate },
            { id: 'character_context_menu_delete', callback: characterGroupOverlay.handleContextMenuDelete },
            { id: 'character_context_menu_persona', callback: characterGroupOverlay.handleContextMenuPersona },
            { id: 'character_context_menu_tag', callback: characterGroupOverlay.handleContextMenuTag },
        ];

        contextMenuItems.forEach(contextMenuItem => document.getElementById(contextMenuItem.id).addEventListener('click', contextMenuItem.callback));
    }
}

/**
 * Represents a tag control not bound to a single character
 */
class BulkTagPopupHandler {
    /**
     * The characters for this popup
     * @type {number[]}
     */
    characterIds;

    /**
     * A storage of the current mutual tags, as calculated by getMutualTags()
     * @type {object[]}
     */
    currentMutualTags;

    /**
     * Sets up the bulk popup menu handler for the given overlay.
     *
     * Characters can be passed in with the show() call.
     */
    constructor() { }

    /**
     * Gets the HTML as a string that is going to be the popup for the bulk tag edit
     *
     * @returns String containing the html for the popup
     */
    #getHtml = () => {
        const characterData = JSON.stringify({ characterIds: this.characterIds });
        return `<div id="bulk_tag_shadow_popup">
            <div id="bulk_tag_popup" class="wider_dialogue_popup">
                <div id="bulk_tag_popup_holder">
                    <h3 class="marginBot5">Modify tags of ${this.characterIds.length} characters</h3>
                    <small class="bulk_tags_desc m-b-1">Add or remove the mutual tags of all selected characters. Import all or existing tags for all selected characters.</small>
                    <div id="bulk_tags_avatars_block" class="avatars_inline avatars_inline_small tags tags_inline"></div>
                    <br>
                    <div id="bulk_tags_div" class="marginBot5" data-characters='${characterData}'>
                        <div class="tag_controls">
                            <input id="bulkTagInput" class="text_pole tag_input wide100p margin0" data-i18n="[placeholder]Search / Create Tags" placeholder="Search / Create tags" maxlength="25" />
                            <div class="tags_view menu_button fa-solid fa-tags" title="View all tags" data-i18n="[title]View all tags"></div>
                        </div>
                        <div id="bulkTagList" class="m-t-1 tags"></div>
                    </div>
                    <div id="dialogue_popup_controls" class="m-t-1">
                        <div id="bulk_tag_popup_reset" class="menu_button" title="Remove all tags from the selected characters" data-i18n="[title]Remove all tags from the selected characters">
                            <i class="fa-solid fa-trash-can margin-right-10px"></i>
                            All
                        </div>
                        <div id="bulk_tag_popup_remove_mutual" class="menu_button" title="Remove all mutual tags from the selected characters" data-i18n="[title]Remove all mutual tags from the selected characters">
                            <i class="fa-solid fa-trash-can margin-right-10px"></i>
                            Mutual
                        </div>
                        <div id="bulk_tag_popup_import_all_tags" class="menu_button" title="Import all tags from selected characters" data-i18n="[title]Import all tags from selected characters">
                            Import All
                        </div>
                        <div id="bulk_tag_popup_import_existing_tags" class="menu_button" title="Import existing tags from selected characters" data-i18n="[title]Import existing tags from selected characters">
                            Import Existing
                        </div>
                        <div id="bulk_tag_popup_cancel" class="menu_button" data-i18n="Cancel">Close</div>
                    </div>
                </div>
            </div>
        </div>`;
    };

    /**
     * Append and show the tag control
     *
     * @param {number[]} characterIds - The characters that are shown inside the popup
     */
    show(characterIds) {
        // shallow copy character ids persistently into this tooltip
        this.characterIds = characterIds.slice();

        if (this.characterIds.length == 0) {
            console.log('No characters selected for bulk edit tags.');
            return;
        }

        document.body.insertAdjacentHTML('beforeend', this.#getHtml());

        const entities = this.characterIds.map(id => characterToEntity(characters[id], id)).filter(entity => entity.item !== undefined);
        buildAvatarList($('#bulk_tags_avatars_block'), entities);

        // Print the tag list with all mutuable tags, marking them as removable. That is the initial fill
        printTagList($('#bulkTagList'), { tags: () => this.getMutualTags(), tagOptions: { removable: true } });

        // Tag input with resolvable list for the mutual tags to get redrawn, so that newly added tags get sorted correctly
        createTagInput('#bulkTagInput', '#bulkTagList', { tags: () => this.getMutualTags(), tagOptions: { removable: true } });

        document.querySelector('#bulk_tag_popup_reset').addEventListener('click', this.resetTags.bind(this));
        document.querySelector('#bulk_tag_popup_remove_mutual').addEventListener('click', this.removeMutual.bind(this));
        document.querySelector('#bulk_tag_popup_cancel').addEventListener('click', this.hide.bind(this));
        document.querySelector('#bulk_tag_popup_import_all_tags').addEventListener('click', this.importAllTags.bind(this));
        document.querySelector('#bulk_tag_popup_import_existing_tags').addEventListener('click', this.importExistingTags.bind(this));
    }

    /**
     * Import existing tags for all selected characters
     */
    async importExistingTags() {
        for (const characterId of this.characterIds) {
            await importTags(characters[characterId], { importSetting: tag_import_setting.ONLY_EXISTING });
        }

        $('#bulkTagList').empty();
    }

    /**
     * Import all tags for all selected characters
     */
    async importAllTags() {
        for (const characterId of this.characterIds) {
            await importTags(characters[characterId], { importSetting: tag_import_setting.ALL });
        }

        $('#bulkTagList').empty();
    }

    /**
     * Builds a list of all tags that the provided characters have in common.
     *
     * @returns {Array<object>} A list of mutual tags
     */
    getMutualTags() {
        if (this.characterIds.length == 0) {
            return [];
        }

        if (this.characterIds.length === 1) {
            // Just use tags of the single character
            return getTagsList(getTagKeyForEntity(this.characterIds[0]));
        }

        // Find mutual tags for multiple characters
        const allTags = this.characterIds.map(cid => getTagsList(getTagKeyForEntity(cid)));
        const mutualTags = allTags.reduce((mutual, characterTags) =>
            mutual.filter(tag => characterTags.some(cTag => cTag.id === tag.id)),
        );

        this.currentMutualTags = mutualTags.sort(compareTagsForSort);
        return this.currentMutualTags;
    }

    /**
     * Hide and remove the tag control
     */
    hide() {
        let popupElement = document.querySelector('#bulk_tag_shadow_popup');
        if (popupElement) {
            document.body.removeChild(popupElement);
        }

        // No need to redraw here, all tags actions were redrawn when they happened
    }

    /**
     * Empty the tag map for the given characters
     */
    resetTags() {
        for (const characterId of this.characterIds) {
            const key = getTagKeyForEntity(characterId);
            if (key) tag_map[key] = [];
        }

        $('#bulkTagList').empty();

        printCharactersDebounced();
    }

    /**
     * Remove the mutual tags for all given characters
     */
    removeMutual() {
        const mutualTags = this.getMutualTags();

        for (const characterId of this.characterIds) {
            for (const tag of mutualTags) {
                removeTagFromMap(tag.id, characterId);
            }
        }

        $('#bulkTagList').empty();

        printCharactersDebounced();
    }
}

class BulkEditOverlayState {
    /**
     *
     * @type {number}
     */
    static browse = 0;

    /**
     *
     * @type {number}
     */
    static select = 1;
}

/**
 * Implement a SingletonPattern, allowing access to the group overlay instance
 * from everywhere via (new CharacterGroupOverlay())
 *
 * @type BulkEditOverlay
 */
let bulkEditOverlayInstance = null;

class BulkEditOverlay {
    static containerId = 'rm_print_characters_block';
    static contextMenuId = 'character_context_menu';
    static characterClass = 'character_select';
    static groupClass = 'group_select';
    static bogusFolderClass = 'bogus_folder_select';
    static selectModeClass = 'group_overlay_mode_select';
    static selectedClass = 'character_selected';
    static legacySelectedClass = 'bulk_select_checkbox';
    static bulkSelectedCountId = 'bulkSelectedCount';

    static longPressDelay = 2500;

    #state = BulkEditOverlayState.browse;
    #longPress = false;
    #stateChangeCallbacks = [];
    #selectedCharacters = [];
    #bulkTagPopupHandler = new BulkTagPopupHandler();

    /**
     * @typedef {object} LastSelected - An object noting the last selected character and its state.
     * @property {number} [characterId] - The character id of the last selected character.
     * @property {boolean} [select] - The selected state of the last selected character. <c>true</c> if it was selected, <c>false</c> if it was deselected.
     */

    /**
     * @type {LastSelected} - An object noting the last selected character and its state.
     */
    lastSelected = { characterId: undefined, select: undefined };

    /**
     * Locks other pointer actions when the context menu is open
     *
     * @type {boolean}
     */
    #contextMenuOpen = false;

    /**
     * Whether the next character select should be skipped
     *
     * @type {boolean}
     */
    #cancelNextToggle = false;

    /**
     * @type HTMLElement
     */
    container = null;

    get state() {
        return this.#state;
    }

    set state(newState) {
        if (this.#state === newState) return;

        eventSource.emit(event_types.CHARACTER_GROUP_OVERLAY_STATE_CHANGE_BEFORE, newState)
            .then(() => {
                this.#state = newState;
                eventSource.emit(event_types.CHARACTER_GROUP_OVERLAY_STATE_CHANGE_AFTER, this.state);
            });
    }

    get isLongPress() {
        return this.#longPress;
    }

    set isLongPress(longPress) {
        this.#longPress = longPress;
    }

    get stateChangeCallbacks() {
        return this.#stateChangeCallbacks;
    }

    /**
     *
     * @returns {number[]}
     */
    get selectedCharacters() {
        return this.#selectedCharacters;
    }

    /**
     * The instance of the bulk tag popup handler that handles tagging of all selected characters
     *
     * @returns {BulkTagPopupHandler}
     */
    get bulkTagPopupHandler() {
        return this.#bulkTagPopupHandler;
    }

    constructor() {
        if (bulkEditOverlayInstance instanceof BulkEditOverlay)
            return bulkEditOverlayInstance;

        this.container = document.getElementById(BulkEditOverlay.containerId);

        eventSource.on(event_types.CHARACTER_GROUP_OVERLAY_STATE_CHANGE_AFTER, this.handleStateChange);
        bulkEditOverlayInstance = Object.freeze(this);
    }

    /**
     * Set the overlay to browse mode
     */
    browseState = () => this.state = BulkEditOverlayState.browse;

    /**
     * Set the overlay to select mode
     */
    selectState = () => this.state = BulkEditOverlayState.select;

    /**
     * Set up a Sortable grid for the loaded page
     */
    onPageLoad = () => {
        this.browseState();

        const elements = this.#getEnabledElements();
        elements.forEach(element => element.addEventListener('touchstart', this.handleHold));
        elements.forEach(element => element.addEventListener('mousedown', this.handleHold));
        elements.forEach(element => element.addEventListener('contextmenu', this.handleDefaultContextMenu));

        elements.forEach(element => element.addEventListener('touchend', this.handleLongPressEnd));
        elements.forEach(element => element.addEventListener('mouseup', this.handleLongPressEnd));
        elements.forEach(element => element.addEventListener('dragend', this.handleLongPressEnd));
        elements.forEach(element => element.addEventListener('touchmove', this.handleLongPressEnd));

        // Cohee: It only triggers when clicking on a margin between the elements?
        // Feel free to fix or remove this, I'm not sure how to.
        //this.container.addEventListener('click', this.handleCancelClick);
    };

    /**
     * Handle state changes
     *
     *
     */
    handleStateChange = () => {
        switch (this.state) {
            case BulkEditOverlayState.browse:
                this.container.classList.remove(BulkEditOverlay.selectModeClass);
                this.#contextMenuOpen = false;
                this.#enableClickEventsForCharacters();
                this.#enableClickEventsForGroups();
                this.clearSelectedCharacters();
                this.disableContextMenu();
                this.#disableBulkEditButtonHighlight();
                CharacterContextMenu.hide();
                break;
            case BulkEditOverlayState.select:
                this.container.classList.add(BulkEditOverlay.selectModeClass);
                this.#disableClickEventsForCharacters();
                this.#disableClickEventsForGroups();
                this.enableContextMenu();
                this.#enableBulkEditButtonHighlight();
                break;
        }

        this.stateChangeCallbacks.forEach(callback => callback(this.state));
    };

    /**
     * Block the browsers native context menu and
     * set a click event to hide the custom context menu.
     */
    enableContextMenu = () => {
        this.container.addEventListener('contextmenu', this.handleContextMenuShow);
        document.addEventListener('click', this.handleContextMenuHide);
    };

    /**
     * Remove event listeners, allowing the native browser context
     * menu to be opened.
     */
    disableContextMenu = () => {
        this.container.removeEventListener('contextmenu', this.handleContextMenuShow);
        document.removeEventListener('click', this.handleContextMenuHide);
    };

    handleDefaultContextMenu = (event) => {
        if (this.isLongPress) {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
    };

    /**
     * Opens menu on long-press.
     *
     * @param event - Pointer event
     */
    handleHold = (event) => {
        if (0 !== event.button && event.type !== 'touchstart') return;
        if (this.#contextMenuOpen) {
            this.#contextMenuOpen = false;
            this.#cancelNextToggle = true;
            CharacterContextMenu.hide();
            return;
        }

        let cancel = false;

        const cancelHold = (event) => cancel = true;
        this.container.addEventListener('mouseup', cancelHold);
        this.container.addEventListener('touchend', cancelHold);

        this.isLongPress = true;

        setTimeout(() => {
            if (this.isLongPress && !cancel) {
                if (this.state === BulkEditOverlayState.browse) {
                    this.selectState();
                } else if (this.state === BulkEditOverlayState.select) {
                    this.#contextMenuOpen = true;
                    CharacterContextMenu.show(...this.#getContextMenuPosition(event));
                }
            }

            this.container.removeEventListener('mouseup', cancelHold);
            this.container.removeEventListener('touchend', cancelHold);
        }, BulkEditOverlay.longPressDelay);
    };

    handleLongPressEnd = (event) => {
        this.isLongPress = false;
        if (this.#contextMenuOpen) event.stopPropagation();
    };

    handleCancelClick = () => {
        if (false === this.#contextMenuOpen) this.state = BulkEditOverlayState.browse;
        this.#contextMenuOpen = false;
    };

    /**
     * Returns the position of the mouse/touch location
     *
     * @param event
     * @returns {(boolean|number|*)[]}
     */
    #getContextMenuPosition = (event) => [
        event.clientX || event.touches[0].clientX,
        event.clientY || event.touches[0].clientY,
    ];

    #stopEventPropagation = (event) => {
        if (this.#contextMenuOpen) {
            this.handleContextMenuHide(event);
        }
        event.stopPropagation();
    };

    #enableClickEventsForGroups = () => this.#getDisabledElements().forEach((element) => element.removeEventListener('click', this.#stopEventPropagation));

    #disableClickEventsForGroups = () => this.#getDisabledElements().forEach((element) => element.addEventListener('click', this.#stopEventPropagation));

    #enableClickEventsForCharacters = () => this.#getEnabledElements().forEach(element => element.removeEventListener('click', this.toggleCharacterSelected));

    #disableClickEventsForCharacters = () => this.#getEnabledElements().forEach(element => element.addEventListener('click', this.toggleCharacterSelected));

    #enableBulkEditButtonHighlight = () => document.getElementById('bulkEditButton').classList.add('bulk_edit_overlay_active');

    #disableBulkEditButtonHighlight = () => document.getElementById('bulkEditButton').classList.remove('bulk_edit_overlay_active');

    #getEnabledElements = () => [...this.container.getElementsByClassName(BulkEditOverlay.characterClass)];

    #getDisabledElements = () => [...this.container.getElementsByClassName(BulkEditOverlay.groupClass), ...this.container.getElementsByClassName(BulkEditOverlay.bogusFolderClass)];

    toggleCharacterSelected = event => {
        event.stopPropagation();

        const character = event.currentTarget;

        if (!this.#contextMenuOpen && !this.#cancelNextToggle) {
            if (event.shiftKey) {
                // Shift click might have selected text that we don't want to. Unselect it.
                document.getSelection().removeAllRanges();

                this.handleShiftClick(character);
            } else {
                this.toggleSingleCharacter(character);
            }
        }

        this.#cancelNextToggle = false;
    };

    /**
     * When shift click was held down, this function handles the multi select of characters in a single click.
     *
     * If the last clicked character was deselected, and the current one was deselected too, it will deselect all currently selected characters between those two.
     * If the last clicked character was selected, and the current one was selected too, it will select all currently not selected characters between those two.
     * If the states do not match, nothing will happen.
     *
     * @param {HTMLElement} currentCharacter - The html element of the currently toggled character
     */
    handleShiftClick = (currentCharacter) => {
        const characterId = Number(currentCharacter.getAttribute('data-chid'));
        const select = !this.selectedCharacters.includes(characterId);

        if (this.lastSelected.characterId >= 0 && this.lastSelected.select !== undefined) {
            // Only if select state and the last select state match we execute the range select
            if (select === this.lastSelected.select) {
                this.toggleCharactersInRange(currentCharacter, select);
            }
        }
    };

    /**
     * Toggles the selection of a given characters
     *
     * @param {HTMLElement} character - The html element of a character
     * @param {object} param1 - Optional params
     * @param {boolean} [param1.markState] - Whether the toggle of this character should be remembered as the last done toggle
     */
    toggleSingleCharacter = (character, { markState = true } = {}) => {
        const characterId = Number(character.getAttribute('data-chid'));

        const select = !this.selectedCharacters.includes(characterId);
        const legacyBulkEditCheckbox = character.querySelector('.' + BulkEditOverlay.legacySelectedClass);

        if (select) {
            character.classList.add(BulkEditOverlay.selectedClass);
            if (legacyBulkEditCheckbox) legacyBulkEditCheckbox.checked = true;
            this.#selectedCharacters.push(characterId);
        } else {
            character.classList.remove(BulkEditOverlay.selectedClass);
            if (legacyBulkEditCheckbox) legacyBulkEditCheckbox.checked = false;
            this.#selectedCharacters = this.#selectedCharacters.filter(item => characterId !== item);
        }

        this.updateSelectedCount();

        if (markState) {
            this.lastSelected.characterId = characterId;
            this.lastSelected.select = select;
        }
    };

    /**
     * Updates the selected count element with the current count
     *
     * @param {number} [countOverride] - optional override for a manual number to set
     */
    updateSelectedCount = (countOverride = undefined) => {
        const count = countOverride ?? this.selectedCharacters.length;
        $(`#${BulkEditOverlay.bulkSelectedCountId}`).text(count).attr('title', `${count} characters selected`);
    };

    /**
     * Toggles the selection of characters in a given range.
     * The range is provided by the given character and the last selected one remembered in the selection state.
     *
     * @param {HTMLElement} currentCharacter - The html element of the currently toggled character
     * @param {boolean} select - <c>true</c> if the characters in the range are to be selected, <c>false</c> if deselected
     */
    toggleCharactersInRange = (currentCharacter, select) => {
        const currentCharacterId = Number(currentCharacter.getAttribute('data-chid'));
        const characters = Array.from(document.querySelectorAll('#' + BulkEditOverlay.containerId + ' .' + BulkEditOverlay.characterClass));

        const startIndex = characters.findIndex(c => Number(c.getAttribute('data-chid')) === Number(this.lastSelected.characterId));
        const endIndex = characters.findIndex(c => Number(c.getAttribute('data-chid')) === currentCharacterId);

        for (let i = Math.min(startIndex, endIndex); i <= Math.max(startIndex, endIndex); i++) {
            const character = characters[i];
            const characterId = Number(character.getAttribute('data-chid'));
            const isCharacterSelected = this.selectedCharacters.includes(characterId);

            // Only toggle the character if it wasn't on the state we have are toggling towards.
            // Also doing a weird type check, because typescript checker doesn't like the return of 'querySelectorAll'.
            if ((select && !isCharacterSelected || !select && isCharacterSelected) && character instanceof HTMLElement) {
                this.toggleSingleCharacter(character, { markState: currentCharacterId == characterId });
            }
        }
    };

    handleContextMenuShow = (event) => {
        event.preventDefault();
        CharacterContextMenu.show(...this.#getContextMenuPosition(event));
        this.#contextMenuOpen = true;
    };

    handleContextMenuHide = (event) => {
        let contextMenu = document.getElementById(BulkEditOverlay.contextMenuId);
        if (false === contextMenu.contains(event.target)) {
            CharacterContextMenu.hide();
        }
    };

    /**
     * Concurrently handle character favorite requests.
     *
     * @returns {Promise<void>}
     */
    handleContextMenuFavorite = async () => {
        const promises = [];

        for (const characterId of this.selectedCharacters) {
            promises.push(CharacterContextMenu.favorite(characterId));
        }

        await Promise.allSettled(promises);
        await getCharacters();
        await favsToHotswap();
        this.browseState();
    };

    /**
     * Concurrently handle character duplicate requests.
     *
     * @returns {Promise<number>}
     */
    handleContextMenuDuplicate = () => Promise.all(this.selectedCharacters.map(async characterId => CharacterContextMenu.duplicate(characterId)))
        .then(() => getCharacters())
        .then(() => this.browseState());

    /**
     * Sequentially handle all character-to-persona conversions.
     *
     * @returns {Promise<void>}
     */
    handleContextMenuPersona = async () => {
        for (const characterId of this.selectedCharacters) {
            await CharacterContextMenu.persona(characterId);
        }

        this.browseState();
    };

    /**
     * Gets the HTML as a string that is displayed inside the popup for the bulk delete
     *
     * @param {Array<number>} characterIds - The characters that are shown inside the popup
     * @returns String containing the html for the popup content
     */
    static #getDeletePopupContentHtml = (characterIds) => {
        return `
            <h3 class="marginBot5">Delete ${characterIds.length} characters?</h3>
            <span class="bulk_delete_note">
                <i class="fa-solid fa-triangle-exclamation warning margin-r5"></i>
                <b>THIS IS PERMANENT!</b>
            </span>
            <div id="bulk_delete_avatars_block" class="avatars_inline avatars_inline_small tags tags_inline m-t-1"></div>
            <br>
            <div id="bulk_delete_options" class="m-b-1">
                <label for="del_char_checkbox" class="checkbox_label justifyCenter">
                    <input type="checkbox" id="del_char_checkbox" />
                    <span>Also delete the chat files</span>
                </label>
            </div>`;
    };

    /**
     * Request user input before concurrently handle deletion
     * requests.
     *
     * @returns {Promise<number>}
     */
    handleContextMenuDelete = () => {
        const characterIds = this.selectedCharacters;
        const popupContent = $(BulkEditOverlay.#getDeletePopupContentHtml(characterIds));
        const checkbox = popupContent.find('#del_char_checkbox');
        const promise = callGenericPopup(popupContent, POPUP_TYPE.CONFIRM)
            .then((accept) => {
                if (!accept) return;

                const deleteChats = checkbox.prop('checked') ?? false;

                showLoader();
                const toast = toastr.info('We\'re deleting your characters, please wait...', 'Working on it');
                const avatarList = characterIds.map(id => characters[id]?.avatar).filter(a => a);
                return CharacterContextMenu.delete(avatarList, deleteChats)
                    .then(() => this.browseState())
                    .finally(() => {
                        toastr.clear(toast);
                        hideLoader();
                    });
            });

        // At this moment the popup is already changed in the dom, but not yet closed/resolved. We build the avatar list here
        const entities = characterIds.map(id => characterToEntity(characters[id], id)).filter(entity => entity.item !== undefined);
        buildAvatarList($('#bulk_delete_avatars_block'), entities);

        return promise;
    };

    /**
     * Attaches and opens the tag menu
     */
    handleContextMenuTag = () => {
        CharacterContextMenu.tag(this.selectedCharacters);
        this.browseState();
    };

    addStateChangeCallback = callback => this.stateChangeCallbacks.push(callback);

    /**
     * Clears internal character storage and
     * removes visual highlight.
     */
    clearSelectedCharacters = () => {
        document.querySelectorAll('#' + BulkEditOverlay.containerId + ' .' + BulkEditOverlay.selectedClass)
            .forEach(element => element.classList.remove(BulkEditOverlay.selectedClass));
        this.selectedCharacters.length = 0;
    };
}

/**
 * Manages bulk operations for chat files in the chat manager
 */
class ChatBulkManager {
    static containerId = 'select_chat_div';
    static selectedClass = 'chat_selected';
    static checkboxClass = 'chat_bulk_checkbox';
    static selectAllId = 'chat_select_all';
    static bulkDeleteId = 'chat_bulk_delete';
    static bulkControlsId = 'chat_bulk_controls';

    #selectedChats = [];
    #isInitialized = false;

    /**
     * Initialize the bulk chat manager
     */
    initialize() {
        if (this.#isInitialized) return;

        this.#addBulkControls();
        this.#setupEventListeners();
        this.#isInitialized = true;
    }

    /**
     * Reset the state when chat manager is opened
     */
    resetState() {
        // Exit bulk mode if currently active
        if ($(`#${ChatBulkManager.bulkControlsId}`).is(':visible')) {
            this.exitBulkMode();
        }
        
        // Clear any selections
        this.#selectedChats = [];
        
        // Remove any existing checkboxes from previous sessions
        $(`.${ChatBulkManager.checkboxClass}`).remove();
        $('.select_chat_block_wrapper').removeClass('bulk-mode');
        
        // Ensure bulk controls are hidden and toggle button is visible
        $(`#${ChatBulkManager.bulkControlsId}`).hide();
        $('#chat_bulk_toggle').show();
    }


    /**
     * Add bulk control UI elements to the chat manager
     */
    #addBulkControls() {
        // Try to find a good place to insert bulk controls in the chat manager
        const targetElement = $('#select_chat_search').parent();
        if (targetElement.length === 0) return;

        const bulkControlsHtml = `
            <div id="${ChatBulkManager.bulkControlsId}" class="flex-container alignitemscenter justifySpaceBetween m-t-1" style="display: none;">
                <div class="flex-container alignitemscenter gap10px">
                    <label class="checkbox_label">
                        <input type="checkbox" id="${ChatBulkManager.selectAllId}" />
                        <span>Select All</span>
                    </label>
                    <span id="chat_selected_count" class="text_muted">0 selected</span>
                </div>
                <div class="flex-container gap10px">
                    <button id="${ChatBulkManager.bulkDeleteId}" class="menu_button menu_button_icon" disabled>
                        <i class="fa-solid fa-trash"></i>
                        <span>Delete Selected</span>
                    </button>
                    <button id="chat_bulk_cancel" class="menu_button">
                        <span>Cancel</span>
                    </button>
                </div>
            </div>
            <button id="chat_bulk_toggle" class="menu_button">
                <i class="fa-solid fa-check-square"></i>
                <span>Bulk Delete</span>
            </button>
        `;

        targetElement.after(bulkControlsHtml);
    }

        /**
     * Setup event listeners for bulk operations
     */
    #setupEventListeners() {
        // Toggle button to enter bulk mode (desktop and mobile)
        $('#chat_bulk_toggle').on('click', () => {
            this.enterBulkMode();
        });

        // Select all checkbox
        $(`#${ChatBulkManager.selectAllId}`).on('change', (e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
                // Select all: collect all filenames and update checkboxes
                this.#selectedChats = [];
                $(`.${ChatBulkManager.checkboxClass}`).each((index, element) => {
                    const fileName = $(element).data('filename');
                    if (!this.#selectedChats.includes(fileName)) {
                        this.#selectedChats.push(fileName);
                    }
                    $(element).prop('checked', true);
                });
            } else {
                // Unselect all: clear the selected chats array and uncheck all boxes
                this.#selectedChats = [];
                $(`.${ChatBulkManager.checkboxClass}`).prop('checked', false);
            }
            this.#updateUI();
        });

        // Handle clicking on individual checkboxes
        $(document).on('click', `.${ChatBulkManager.checkboxClass}`, (e) => {
            e.stopPropagation(); // Prevent event bubbling to wrapper
        });

        $(document).on('change', `.${ChatBulkManager.checkboxClass}`, (e) => {
            e.stopPropagation();
            const fileName = $(e.target).data('filename');
            if (e.target.checked) {
                if (!this.#selectedChats.includes(fileName)) {
                    this.#selectedChats.push(fileName);
                }
            } else {
                const index = this.#selectedChats.indexOf(fileName);
                if (index > -1) {
                    this.#selectedChats.splice(index, 1);
                }
            }
            this.#updateUI();
        });

        // Handle clicking on the entire chat wrapper div in bulk mode  
        $(document).on('click', '.select_chat_block_wrapper.bulk-mode', (e) => {  
            // Don't handle clicks on checkboxes themselves
            if ($(e.target).hasClass(ChatBulkManager.checkboxClass)) {
                return;
            }
            
            e.preventDefault();  
            e.stopPropagation();  
            
            const $wrapper = $(e.currentTarget);  
            const fileName = $wrapper.find('.select_chat_block').attr('file_name');  
            const checkbox = $wrapper.find(`.${ChatBulkManager.checkboxClass}`);  
            
            // Toggle the checkbox state  
            const isCurrentlyChecked = checkbox.prop('checked');  
            checkbox.prop('checked', !isCurrentlyChecked);  
            
            // Update the selection state  
            if (!isCurrentlyChecked) {  
                if (!this.#selectedChats.includes(fileName)) {  
                    this.#selectedChats.push(fileName);  
                }  
            } else {  
                const index = this.#selectedChats.indexOf(fileName);  
                if (index > -1) {  
                    this.#selectedChats.splice(index, 1);  
                }  
            }  
            
            this.#updateUI();  
        });

        // Bulk delete button
        $(`#${ChatBulkManager.bulkDeleteId}`).on('click', () => {
            this.#handleBulkDelete();
        });

        // Cancel bulk mode
        $('#chat_bulk_cancel').on('click', () => {
            this.exitBulkMode();
        });
    }
    /**
     * Enter bulk selection mode
     */
    enterBulkMode() {
        // Add checkboxes to each chat item only if they don't already exist
        $('.select_chat_block_wrapper').each((index, element) => {
            const $element = $(element);
            const fileName = $element.find('.select_chat_block').attr('file_name');
            if ($element.find(`.${ChatBulkManager.checkboxClass}`).length === 0) {
                const checkbox = `<input type="checkbox" class="${ChatBulkManager.checkboxClass}" data-filename="${fileName}" style="margin-right: 10px;">`;
                $element.find('.select_chat_block_filename').before(checkbox);
            }
            $element.addClass('bulk-mode');
        });

        // Show bulk controls and hide toggle button
        $(`#${ChatBulkManager.bulkControlsId}`).show();
        $('#chat_bulk_toggle').hide();
        this.#updateUI();
    }

    /**
     * Exit bulk selection mode
     */
    exitBulkMode() {
        // Remove checkboxes
        $(`.${ChatBulkManager.checkboxClass}`).remove();
        $('.select_chat_block_wrapper').removeClass('bulk-mode');

        // Hide bulk controls and show toggle button
        $(`#${ChatBulkManager.bulkControlsId}`).hide();
        $('#chat_bulk_toggle').show();

        // Clear selections
        this.#selectedChats = [];
        this.#updateUI();
    }

    /**
     * Update UI state based on selections
     */
    #updateUI() {
        const selectedCount = this.#selectedChats.length;
        const totalCount = $(`.${ChatBulkManager.checkboxClass}`).length;

        // Update count display
        $('#chat_selected_count').text(`${selectedCount} selected`);

        // Update select all checkbox
        const selectAllCheckbox = $(`#${ChatBulkManager.selectAllId}`);
        selectAllCheckbox.prop('indeterminate', selectedCount > 0 && selectedCount < totalCount);
        selectAllCheckbox.prop('checked', selectedCount === totalCount && totalCount > 0);

        // Enable/disable bulk delete button
        $(`#${ChatBulkManager.bulkDeleteId}`).prop('disabled', selectedCount === 0);
    }

    /**
     * Handle bulk delete operation
     */
    async #handleBulkDelete() {
        if (this.#selectedChats.length === 0) return;

        const popupContent = this.#getDeletePopupContentHtml();
        const accept = await callGenericPopup(popupContent, POPUP_TYPE.CONFIRM);
        
        if (!accept) return;

        let toast;
        try {
            showLoader();  
            toast = toastr.info('Deleting selected chats...', 'Please wait'); 

            let result;
            if (selected_group) {
                // For group chats, use the appropriate function
                result = await bulkDelChat(this.#selectedChats);
            } else if (this_chid !== undefined) {
                // For character chats, convert filenames and use character-specific function
                const fileNames = this.#selectedChats.map(name => name.replace('.jsonl', ''));
                result = await bulkDeleteCharacterChatsByName(this_chid, fileNames);
            } else {
                throw new Error('No character or group selected');
            }

            if (result.failed && result.failed.length > 0) {
                const failedNames = result.failed.map(f => f.file).join(', ');
                toastr.warning(`Some chats could not be deleted: ${failedNames}`, 'Partial success');
            }

            if (result.success && result.success.length > 0) {
                toastr.success(`Successfully deleted ${result.success.length} chat(s)`, 'Success');
            }

            // Refresh the chat list
            await displayPastChats();
            this.exitBulkMode();

        } catch (error) {
            console.error('Bulk delete failed:', error);
            toastr.error('Failed to delete chats. Please try again.', 'Error');
        } finally {
            if (toast) toastr.clear(toast);
            hideLoader();
        }
    }

    /**
     * Generate HTML content for delete confirmation popup
     */
    #getDeletePopupContentHtml() {
        const count = this.#selectedChats.length;
        return `
            <div class="text-center">
                <h3>Delete ${count} chat${count > 1 ? 's' : ''}?</h3>
                <p>This action cannot be undone.</p>
                <div class="m-t-1">
                    <strong>Selected chats:</strong>
                    <ul class="text-left m-t-1" style="max-height: 200px; overflow-y: auto;">
                        ${this.#selectedChats.map(name => `<li>${name}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `;
    }

    /**
     * Get the list of currently selected chat files
     */
    get selectedChats() {
        return [...this.#selectedChats];
    }
}

// Create a global instance for use in the chat manager
const chatBulkManager = new ChatBulkManager();

export { BulkEditOverlayState, CharacterContextMenu, BulkEditOverlay, ChatBulkManager, chatBulkManager };
