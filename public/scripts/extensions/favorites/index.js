/**
 * Favorites Extension for SillyTavern
 * Adds favoriting functionality for both chat messages and chat files
 */

import { eventSource, event_types } from '../../../scripts/events.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../scripts/extensions.js';
import { 
    saveSettingsDebounced, 
    getCurrentChatId, 
    chat, 
    chat_metadata, 
    characters 
} from '../../../script.js';
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../popup.js';
import { t } from '../../../scripts/i18n.js';

// Extension constants
const EXTENSION_NAME = 'Favorites';
const settingsKey = 'SillyTavern-Favorites';
const extensionName = 'favorites';

// Default settings structure
const defaultSettings = {
    enabled: true,
    favoriteMessages: [], // Array of {chatId, messageId, content, timestamp}
    favoriteChatFiles: [], // Array of {filename, timestamp}
    windowPosition: { x: 100, y: 100 },
    activeTab: 'messages' // 'messages' or 'chatfiles'
};

// Global state
let settings = {};
let favoritesWindow = null;

/**
 * Initialize the extension settings
 */
function initializeSettings() {
    // Get extension settings from context
    const context = getContext();
    
    // Initialize settings if they don't exist
    if (!context.extensionSettings[settingsKey]) {
        context.extensionSettings[settingsKey] = { ...defaultSettings };
    }
    
    // Load current settings
    settings = context.extensionSettings[settingsKey];
    
    // Ensure all default properties exist
    Object.keys(defaultSettings).forEach(key => {
        if (settings[key] === undefined) {
            settings[key] = defaultSettings[key];
        }
    });
    
    console.log('Favorites extension settings initialized:', settings);
}

/**
 * Save extension settings
 */
function saveSettings() {
    const context = getContext();
    context.extensionSettings[settingsKey] = settings;
    saveSettingsDebounced();
}

/**
 * Add star button to a message element
 */
function addStarButtonToMessage(messageId) {
    const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
    if (!messageElement.length) return;
    
    const mesButtons = messageElement.find('.mes_buttons');
    if (!mesButtons.length) return;
    
    // Check if star button already exists
    if (mesButtons.find('.mes_favorite').length > 0) return;
    
    // Get message data
    const chat = getContext().chat;
    const messageData = chat[messageId];
    if (!messageData) return;
    
    // Check if message is favorited
    const isFavorited = isMessageFavorited(messageId);
    
    // Create star button
    const starButton = $(`
        <div title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}" 
             class="mes_button mes_favorite fa-${isFavorited ? 'solid' : 'regular'} fa-star" 
             data-i18n="[title]${isFavorited ? 'Remove from favorites' : 'Add to favorites'}"
             data-message-id="${messageId}">
        </div>
    `);
    
    // Add click handler
    starButton.on('click', function(e) {
        e.stopPropagation();
        toggleMessageFavorite(messageId);
    });
    
    // Insert star button before the edit button
    const editButton = mesButtons.find('.mes_edit');
    if (editButton.length > 0) {
        starButton.insertBefore(editButton);
    } else {
        // Fallback: add to end of mes_buttons
        mesButtons.append(starButton);
    }
}

/**
 * Add star button to chat file in selection interface
 */
function addStarButtonToChatFile() {
    $('.select_chat_block_wrapper').each(function() {
        const wrapper = $(this);
        const filename = wrapper.find('.select_chat_block').attr('file_name');
        
        if (!filename || wrapper.find('.favoriteChatButton').length > 0) return;
        
        const isFavorited = isChatFileFavorited(filename);
        
        // Create star button
        const starButton = $(`
            <div title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}" 
                 class="favoriteChatButton hoverglow opacity50p fa-${isFavorited ? 'solid' : 'regular'} fa-star fa-sm" 
                 data-i18n="[title]${isFavorited ? 'Remove from favorites' : 'Add to favorites'}"
                 data-filename="${filename}">
            </div>
        `);
        
        // Add click handler
        starButton.on('click', function(e) {
            e.stopPropagation();
            toggleChatFileFavorite(filename);
        });
        
        // Insert after rename button
        const renameButton = wrapper.find('.renameChatButton');
        if (renameButton.length > 0) {
            starButton.insertAfter(renameButton);
        }
    });
}

/**
 * Check if a message is favorited
 */
function isMessageFavorited(messageId) {
    const context = getContext();
    const currentChatId = context.chatId;
    
    return settings.favoriteMessages.some(fav => 
        fav.chatId === currentChatId && fav.messageId === messageId
    );
}

/**
 * Check if a chat file is favorited
 */
function isChatFileFavorited(filename) {
    return settings.favoriteChatFiles.some(fav => fav.filename === filename);
}

/**
 * Toggle message favorite status
 */
function toggleMessageFavorite(messageId) {
    const context = getContext();
    const currentChatId = context.chatId;
    const chat = context.chat;
    const messageData = chat[messageId];
    
    if (!messageData) return;
    
    const favoriteIndex = settings.favoriteMessages.findIndex(fav => 
        fav.chatId === currentChatId && fav.messageId === messageId
    );
    
    if (favoriteIndex >= 0) {
        // Remove from favorites
        settings.favoriteMessages.splice(favoriteIndex, 1);
        updateMessageStarButton(messageId, false);
        console.log('Message removed from favorites:', messageId);
    } else {
        // Add to favorites
        const favoriteMessage = {
            chatId: currentChatId,
            messageId: messageId,
            content: messageData.mes || '',
            character: messageData.name || '',
            timestamp: Date.now()
        };
        
        settings.favoriteMessages.push(favoriteMessage);
        updateMessageStarButton(messageId, true);
        console.log('Message added to favorites:', messageId);
    }
    
    saveSettings();
    
    // Update favorites window if open
    if (favoritesWindow && !favoritesWindow.is(':hidden')) {
        refreshFavoritesWindow();
    }
}

/**
 * Toggle chat file favorite status
 */
function toggleChatFileFavorite(filename) {
    const favoriteIndex = settings.favoriteChatFiles.findIndex(fav => fav.filename === filename);
    
    if (favoriteIndex >= 0) {
        // Remove from favorites
        settings.favoriteChatFiles.splice(favoriteIndex, 1);
        updateChatFileStarButton(filename, false);
        console.log('Chat file removed from favorites:', filename);
    } else {
        // Add to favorites
        const favoriteChatFile = {
            filename: filename,
            timestamp: Date.now()
        };
        
        settings.favoriteChatFiles.push(favoriteChatFile);
        updateChatFileStarButton(filename, true);
        console.log('Chat file added to favorites:', filename);
    }
    
    saveSettings();
    
    // Update favorites window if open
    if (favoritesWindow && !favoritesWindow.is(':hidden')) {
        refreshFavoritesWindow();
    }
}

/**
 * Update message star button appearance
 */
function updateMessageStarButton(messageId, isFavorited) {
    const starButton = $(`.mes_favorite[data-message-id="${messageId}"]`);
    if (starButton.length === 0) return;
    
    starButton
        .removeClass('fa-solid fa-regular')
        .addClass(isFavorited ? 'fa-solid' : 'fa-regular')
        .attr('title', isFavorited ? 'Remove from favorites' : 'Add to favorites')
        .attr('data-i18n', `[title]${isFavorited ? 'Remove from favorites' : 'Add to favorites'}`);
}

/**
 * Update chat file star button appearance
 */
function updateChatFileStarButton(filename, isFavorited) {
    const starButton = $(`.favoriteChatButton[data-filename="${filename}"]`);
    if (starButton.length === 0) return;
    
    starButton
        .removeClass('fa-solid fa-regular')
        .addClass(isFavorited ? 'fa-solid' : 'fa-regular')
        .attr('title', isFavorited ? 'Remove from favorites' : 'Add to favorites')
        .attr('data-i18n', `[title]${isFavorited ? 'Remove from favorites' : 'Add to favorites'}`);
}

/**
 * Create and show favorites window
 */
function showFavoritesWindow() {
    if (favoritesWindow && !favoritesWindow.is(':hidden')) {
        favoritesWindow.focus();
        return;
    }
    
    createFavoritesWindow();
    favoritesWindow.show();
    refreshFavoritesWindow();
}

/**
 * Create the favorites window HTML
 */
function createFavoritesWindow() {
    if (favoritesWindow) {
        favoritesWindow.remove();
    }
    
    favoritesWindow = $(`
        <div id="favoritesWindow" class="popup-background" style="display: none;">
            <div class="popup-content">
                <div class="popup-header">
                    <h3>Favorites</h3>
                    <button id="favoritesWindowClose" class="close-button">×</button>
                </div>
                <div class="popup-body">
                    <div class="favorites-tabs">
                        <button class="favorites-tab ${settings.activeTab === 'messages' ? 'active' : ''}" data-tab="messages">
                            Favorite Messages
                        </button>
                        <button class="favorites-tab ${settings.activeTab === 'chatfiles' ? 'active' : ''}" data-tab="chatfiles">
                            Favorite Chat Files
                        </button>
                    </div>
                    <div class="favorites-content">
                        <div id="favoritesMessagesTab" class="favorites-tab-content ${settings.activeTab === 'messages' ? 'active' : ''}">
                            <div class="favorites-list" id="favoriteMessagesList"></div>
                        </div>
                        <div id="favoritesChatFilesTab" class="favorites-tab-content ${settings.activeTab === 'chatfiles' ? 'active' : ''}">
                            <div class="favorites-list" id="favoriteChatFilesList"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);
    
    $('body').append(favoritesWindow);
    
    // Add event handlers
    favoritesWindow.find('#favoritesWindowClose').on('click', () => {
        favoritesWindow.hide();
    });
    
    favoritesWindow.find('.favorites-tab').on('click', function() {
        const tab = $(this).data('tab');
        switchFavoritesTab(tab);
    });
    
    // Close on background click
    favoritesWindow.on('click', function(e) {
        if (e.target === this) {
            favoritesWindow.hide();
        }
    });
}

/**
 * Switch between favorites tabs
 */
function switchFavoritesTab(tab) {
    settings.activeTab = tab;
    saveSettings();
    
    // Update tab buttons
    favoritesWindow.find('.favorites-tab').removeClass('active');
    favoritesWindow.find(`.favorites-tab[data-tab="${tab}"]`).addClass('active');
    
    // Update tab content
    favoritesWindow.find('.favorites-tab-content').removeClass('active');
    favoritesWindow.find(`#favorites${tab === 'messages' ? 'Messages' : 'ChatFiles'}Tab`).addClass('active');
    
    refreshFavoritesWindow();
}

/**
 * Refresh favorites window content
 */
function refreshFavoritesWindow() {
    if (!favoritesWindow || favoritesWindow.is(':hidden')) return;
    
    if (settings.activeTab === 'messages') {
        refreshFavoriteMessagesList();
    } else {
        refreshFavoriteChatFilesList();
    }
}

/**
 * Refresh favorite messages list
 */
function refreshFavoriteMessagesList() {
    const messagesList = favoritesWindow.find('#favoriteMessagesList');
    messagesList.empty();
    
    if (settings.favoriteMessages.length === 0) {
        messagesList.append('<div class="no-favorites">No favorite messages yet</div>');
        return;
    }
    
    // Sort by timestamp (newest first)
    const sortedMessages = [...settings.favoriteMessages].sort((a, b) => b.timestamp - a.timestamp);
    
    sortedMessages.forEach(fav => {
        const messageItem = $(`
            <div class="favorite-item message-item" data-chat-id="${fav.chatId}" data-message-id="${fav.messageId}">
                <div class="favorite-content">
                    <div class="favorite-meta">
                        <span class="favorite-character">${fav.character || 'Unknown'}</span>
                        <span class="favorite-timestamp">${new Date(fav.timestamp).toLocaleString()}</span>
                    </div>
                    <div class="favorite-text">${fav.content.substring(0, 200)}${fav.content.length > 200 ? '...' : ''}</div>
                </div>
                <div class="favorite-actions">
                    <button class="favorite-action-btn jump-to-message" title="Jump to message">
                        <i class="fa-solid fa-arrow-right"></i>
                    </button>
                    <button class="favorite-action-btn remove-favorite" title="Remove from favorites">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `);
        
        messagesList.append(messageItem);
    });
    
    // Add event handlers for favorite actions
    messagesList.find('.jump-to-message').on('click', function() {
        const chatId = $(this).closest('.favorite-item').data('chat-id');
        const messageId = $(this).closest('.favorite-item').data('message-id');
        jumpToMessage(chatId, messageId);
    });
    
    messagesList.find('.remove-favorite').on('click', function() {
        const chatId = $(this).closest('.favorite-item').data('chat-id');
        const messageId = $(this).closest('.favorite-item').data('message-id');
        removeFavoriteMessage(chatId, messageId);
    });
}

/**
 * Refresh favorite chat files list
 */
function refreshFavoriteChatFilesList() {
    const chatFilesList = favoritesWindow.find('#favoriteChatFilesList');
    chatFilesList.empty();
    
    if (settings.favoriteChatFiles.length === 0) {
        chatFilesList.append('<div class="no-favorites">No favorite chat files yet</div>');
        return;
    }
    
    // Sort by timestamp (newest first)
    const sortedFiles = [...settings.favoriteChatFiles].sort((a, b) => b.timestamp - a.timestamp);
    
    sortedFiles.forEach(fav => {
        const fileItem = $(`
            <div class="favorite-item file-item" data-filename="${fav.filename}">
                <div class="favorite-content">
                    <div class="favorite-filename">${fav.filename}</div>
                    <div class="favorite-timestamp">${new Date(fav.timestamp).toLocaleString()}</div>
                </div>
                <div class="favorite-actions">
                    <button class="favorite-action-btn open-chat" title="Open chat">
                        <i class="fa-solid fa-folder-open"></i>
                    </button>
                    <button class="favorite-action-btn remove-favorite" title="Remove from favorites">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `);
        
        chatFilesList.append(fileItem);
    });
    
    // Add event handlers for favorite actions
    chatFilesList.find('.open-chat').on('click', function() {
        const filename = $(this).closest('.favorite-item').data('filename');
        openChatFile(filename);
    });
    
    chatFilesList.find('.remove-favorite').on('click', function() {
        const filename = $(this).closest('.favorite-item').data('filename');
        removeFavoriteChatFile(filename);
    });
}

/**
 * Jump to a specific message in a chat
 */
function jumpToMessage(chatId, messageId) {
    // Implementation depends on SillyTavern's chat loading mechanism
    // This would need to be integrated with the chat loading system
    console.log('Jump to message:', chatId, messageId);
    favoritesWindow.hide();
}

/**
 * Open a specific chat file
 */
function openChatFile(filename) {
    // Trigger chat file selection
    $(`.select_chat_block[file_name="${filename}"]`).trigger('click');
    favoritesWindow.hide();
}

/**
 * Remove favorite message
 */
function removeFavoriteMessage(chatId, messageId) {
    const index = settings.favoriteMessages.findIndex(fav => 
        fav.chatId === chatId && fav.messageId === messageId
    );
    
    if (index >= 0) {
        settings.favoriteMessages.splice(index, 1);
        saveSettings();
        refreshFavoriteMessagesList();
        
        // Update star button if visible
        updateMessageStarButton(messageId, false);
    }
}

/**
 * Remove favorite chat file
 */
function removeFavoriteChatFile(filename) {
    const index = settings.favoriteChatFiles.findIndex(fav => fav.filename === filename);
    
    if (index >= 0) {
        settings.favoriteChatFiles.splice(index, 1);
        saveSettings();
        refreshFavoriteChatFilesList();
        
        // Update star button if visible
        updateChatFileStarButton(filename, false);
    }
}

/**
 * Add favorites menu item to extensions menu
 */
function addFavoritesMenuItem() {
    // Create menu container for favorites
    const menuContainer = $(`
        <div id="favorites_wand_container" class="extension_container">
            <div class="extension_menu_button" data-i18n="Favorites" title="Open Favorites">
                <i class="fa-solid fa-star"></i>
                <span>Favorites</span>
            </div>
        </div>
    `);
    
    // Add click handler
    menuContainer.find('.extension_menu_button').on('click', showFavoritesWindow);
    
    // Add to extensions menu
    $('#extensionsMenu').append(menuContainer);
    
    console.log('Favorites menu item added to extensions menu');
}

/**
 * Main extension initialization
 */
function initializeFavoritesExtension() {
    console.log('Initializing Favorites extension...');
    
    // Initialize settings
    initializeSettings();
    
    if (!settings.enabled) {
        console.log('Favorites extension is disabled');
        return;
    }
    
    // Add event listeners for message rendering
    eventSource.on(event_types.USER_MESSAGE_RENDERED, addStarButtonToMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, addStarButtonToMessage);
    
    // Add event listener for chat changes to update chat file buttons
    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(addStarButtonToChatFile, 100); // Small delay to ensure DOM is updated
    });
    
    // Periodically check for new chat files in selection interface
    setInterval(addStarButtonToChatFile, 1000);
    
    // Add menu item to extensions menu
    addFavoritesMenuItem();
    
    console.log('Favorites extension initialized successfully');
}

// jQuery entry point for extension system
export default function() {
    // Wait for DOM to be ready
    $(document).ready(() => {
        initializeFavoritesExtension();
    });
    
    // Return functions that can be called from extension menu
    return {
        showFavorites: showFavoritesWindow
    };
}

// Auto-initialize when module loads
initializeFavoritesExtension();
