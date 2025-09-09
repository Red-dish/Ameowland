/**
 * SillyTavern Favorites Extension
 * Adds favoriting functionality for both chat messages and chat files
 */
import {
	characters,
	eventSource,
	event_types,
	getCurrentChatId,
	saveSettingsDebounced,
	this_chid,
	chat,
	chat_metadata,
} from '../../../script.js';
import {
	extension_settings,
	renderExtensionTemplateAsync,
} from '../../extensions.js';
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../popup.js';
import { t } from '../../i18n.js';

// toastr is available globally in SillyTavern
const toastr = window.toastr;

// Extension constants
const EXTENSION_NAME = 'SillyTavern Favorites';
const settingsKey = 'SillyTavernFavorites';

// Default settings structure
const defaultSettings = {
	enabled: true,
	favoriteMessages: [], // Array of { chatId, messageId, messageText, timestamp, characterName }
	favoriteChatFiles: [], // Array of { fileName, lastModified, characterName, messageCount }
	showStarOnHover: true,
	starPosition: 'right', // 'left' or 'right' in message buttons
};

// Settings reference
let settings = {};

/**
 * Initialize extension settings
 */
function initializeSettings() {
	// Check if settings exist, create default if not
	if (!extension_settings[settingsKey]) {
		console.log(`[${EXTENSION_NAME}] Creating default settings`);
		extension_settings[settingsKey] = {
			...defaultSettings,
		};
	}

	// Reference to settings for easier access
	settings = extension_settings[settingsKey];

	// Ensure all required properties exist (for migration)
	Object.keys(defaultSettings).forEach((key) => {
		if (settings[key] === undefined) {
			settings[key] = defaultSettings[key];
		}
	});

	console.log(`[${EXTENSION_NAME}] Settings initialized:`, settings);
}

/**
 * Save settings to SillyTavern's settings system
 */
async function saveSettings() {
	extension_settings[settingsKey] = settings;
	saveSettingsDebounced();
	console.log(`[${EXTENSION_NAME}] Settings saved`);
}

/**
 * Add a message to favorites
 */
async function addMessageToFavorites(messageData) {
	const chatId = getCurrentChatId();
	const characterName = characters[this_chid]?.name || 'Unknown';
	const favoriteMessage = {
		id: `${chatId}_${messageData.messageId}_${Date.now()}`, // Unique ID
		chatId: chatId,
		messageId: messageData.messageId,
		messageText: messageData.messageText.substring(0, 200), // Truncate for display
		fullMessageText: messageData.messageText,
		timestamp: Date.now(),
		characterName: characterName,
		userName: messageData.userName || 'User',
		isUser: messageData.isUser || false,
	};

	// Check if already favorited
	const exists = settings.favoriteMessages.find(
		(fav) => fav.chatId === chatId && fav.messageId === messageData.messageId,
	);
	if (exists) {
		toastr['info'](t`Message is already in favorites`);
		return false;
	}

	settings.favoriteMessages.push(favoriteMessage);
	await saveSettings();
	toastr['success'](t`Message added to favorites`);
	return true;
}

/**
 * Remove a message from favorites
 */
async function removeMessageFromFavorites(chatId, messageId) {
	const initialLength = settings.favoriteMessages.length;
	settings.favoriteMessages = settings.favoriteMessages.filter(
		(fav) => !(fav.chatId === chatId && fav.messageId === messageId),
	);
	if (settings.favoriteMessages.length < initialLength) {
		await saveSettings();
		toastr['success'](t`Message removed from favorites`);
		return true;
	}
	return false;
}

/**
 * Check if a message is favorited
 */
function isMessageFavorited(chatId, messageId) {
	return settings.favoriteMessages.some(
		(fav) => fav.chatId === chatId && fav.messageId === messageId,
	);
}

/**
 * Add a chat file to favorites
 */
async function addChatFileToFavorites(fileName, fileData = {}) {
	const favoriteFile = {
		id: `${fileName}_${Date.now()}`,
		fileName: fileName,
		lastModified: fileData.lastModified || Date.now(),
		characterName: fileData.characterName || 'Unknown',
		messageCount: fileData.messageCount || 0,
		timestamp: Date.now(),
	};

	// Check if already favorited
	const exists = settings.favoriteChatFiles.find((fav) => fav.fileName === fileName);
	if (exists) {
		toastr['info'](t`Chat file is already in favorites`);
		return false;
	}

	settings.favoriteChatFiles.push(favoriteFile);
	await saveSettings();
	toastr['success'](t`Chat file added to favorites`);
	return true;
}

/**
 * Remove a chat file from favorites
 */
async function removeChatFileFromFavorites(fileName) {
	const initialLength = settings.favoriteChatFiles.length;
	settings.favoriteChatFiles = settings.favoriteChatFiles.filter(
		(fav) => fav.fileName !== fileName,
	);
	if (settings.favoriteChatFiles.length < initialLength) {
		await saveSettings();
		toastr['success'](t`Chat file removed from favorites`);
		return true;
	}
	return false;
}

/**
 * Check if a chat file is favorited
 */
function isChatFileFavorited(fileName) {
	return settings.favoriteChatFiles.some((fav) => fav.fileName === fileName);
}

/**
 * Create star button HTML
 */
function createStarButton(isFavorited, className = '', title = '') {
	const starIcon = isFavorited ? 'fa-solid fa-star' : 'fa-regular fa-star';
	const starColor = isFavorited ? 'style="color: #ffd700;"' : '';
	return `
		<div title="${title}" class="mes_button favorite_button ${className} fa-solid ${starIcon}" ${starColor} data-i18n="[title]${title}">
		</div>
	`;
}

/**
 * Add star button to a message
 */
function addStarButtonToMessage(messageId) {
	const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
	if (messageElement.length === 0) return;
	const messagesContainer = messageElement.find('.mes_buttons');
	if (messagesContainer.length === 0) return;

	// Check if star button already exists
	if (messagesContainer.find('.favorite_button').length > 0) return;

	const chatId = getCurrentChatId();
	const isFavorited = isMessageFavorited(chatId, messageId);
	const starButton = createStarButton(
		isFavorited,
		'message_favorite_button',
		isFavorited ? 'Remove from favorites' : 'Add to favorites',
	);

	// Insert star button at the appropriate position
	if (settings.starPosition === 'left') {
		messagesContainer.find('.extraMesButtons').prepend(starButton);
	} else {
		messagesContainer.find('.extraMesButtons').append(starButton);
	}

	// Add click handler
	messagesContainer
		.find('.message_favorite_button')
		.off('click')
		.on('click', async function (e) {
			e.stopPropagation();
			const messageElement = $(this).closest('.mes');
			const messageId = messageElement.attr('mesid');
			const messageText = messageElement.find('.mes_text').text();
			const isUser = messageElement.hasClass('is_user');
			const userName = messageElement.find('.ch_name').text();
			const chatId = getCurrentChatId();
			const isFavorited = isMessageFavorited(chatId, messageId);

			if (isFavorited) {
				await removeMessageFromFavorites(chatId, messageId);
				$(this).removeClass('fa-solid').addClass('fa-regular').attr('style', '');
				$(this).attr('title', 'Add to favorites');
			} else {
				const messageData = {
					messageId: messageId,
					messageText: messageText,
					isUser: isUser,
					userName: userName,
				};
				await addMessageToFavorites(messageData);
				$(this)
					.removeClass('fa-regular')
					.addClass('fa-solid')
					.attr('style', 'color: #ffd700;');
				$(this).attr('title', 'Remove from favorites');
			}
		});
}

/**
 * Add star buttons to all visible messages
 */
function addStarButtonsToAllMessages() {
	$('#chat .mes').each(function () {
		const messageId = $(this).attr('mesid');
		if (messageId) {
			addStarButtonToMessage(messageId);
		}
	});
}

/**
 * Add star button to chat file in selection interface
 */
function addStarButtonToChatFiles() {
	$('.select_chat_block_wrapper').each(function () {
		const fileWrapper = $(this);
		const renameChatButton = fileWrapper.find('.renameChatButton');

		// Check if star button already exists
		if (fileWrapper.find('.chat_favorite_button').length > 0) return;

		const fileName = fileWrapper.find('.select_chat_block').attr('file_name');
		if (!fileName) return;

		const isFavorited = isChatFileFavorited(fileName);
		const starButton = createStarButton(
			isFavorited,
			'chat_favorite_button',
			isFavorited ? 'Remove chat from favorites' : 'Add chat to favorites',
		);

		// Insert star button after rename button
		renameChatButton.after(starButton);

		// Add click handler
		fileWrapper
			.find('.chat_favorite_button')
			.off('click')
			.on('click', async function (e) {
				e.stopPropagation();
				const fileName = $(this)
					.closest('.select_chat_block_wrapper')
					.find('.select_chat_block')
					.attr('file_name');
				const characterName = $(this)
					.closest('.select_chat_block_wrapper')
					.find('.select_chat_block_filename')
					.text();
				const messageCount = $(this)
					.closest('.select_chat_block_wrapper')
					.find('.chat_messages_num')
					.text();
				const isFavorited = isChatFileFavorited(fileName);

				if (isFavorited) {
					await removeChatFileFromFavorites(fileName);
					$(this).removeClass('fa-solid').addClass('fa-regular').attr('style', '');
					$(this).attr('title', 'Add chat to favorites');
				} else {
					const fileData = {
						characterName: characterName,
						messageCount: parseInt(messageCount) || 0,
					};
					await addChatFileToFavorites(fileName, fileData);
					$(this)
						.removeClass('fa-regular')
						.addClass('fa-solid')
						.attr('style', 'color: #ffd700;');
					$(this).attr('title', 'Remove chat from favorites');
				}
			});
	});
}

/**
 * Show favorites window
 */
async function showFavoritesWindow() {
	const favoritesTemplate = `
		<div class="favorites_window">
			<div class="favorites_tabs">
				<div class="favorites_tab active" data-tab="messages">
					<i class="fa-solid fa-message"></i> Favorite Messages
				</div>
				<div class="favorites_tab" data-tab="chatfiles">
					<i class="fa-solid fa-file"></i> Favorite Chat Files
				</div>
			</div>
			<div class="favorites_content">
				<div id="favorites_messages" class="favorites_tab_content active">
					<div class="favorites_list">
						${
							settings.favoriteMessages.length === 0
								? '<div class="no_favorites">No favorite messages yet</div>'
								: settings.favoriteMessages
										.map(
											(msg) => `
							<div class="favorite_item" data-chat-id="${msg.chatId}" data-message-id="${msg.messageId}">
								<div class="favorite_header">
									<strong>${msg.characterName}</strong>
									<span class="favorite_date">${new Date(
										msg.timestamp,
									).toLocaleDateString()}</span>
									<button class="remove_favorite" data-type="message" data-id="${msg.id}">
										<i class="fa-solid fa-trash"></i>
									</button>
								</div>
								<div class="favorite_text">${msg.messageText}${
									msg.messageText.length >= 200 ? '...' : ''
								}</div>
							</div>
						`,
										)
										.join('')
						}
					</div>
				</div>
				<div id="favorites_chatfiles" class="favorites_tab_content">
					<div class="favorites_list">
						${
							settings.favoriteChatFiles.length === 0
								? '<div class="no_favorites">No favorite chat files yet</div>'
								: settings.favoriteChatFiles
										.map(
											(file) => `
							<div class="favorite_item" data-file-name="${file.fileName}">
								<div class="favorite_header">
									<strong>${file.fileName}</strong>
									<span class="favorite_date">${new Date(
										file.timestamp,
									).toLocaleDateString()}</span>
									<button class="remove_favorite" data-type="chatfile" data-id="${file.id}">
										<i class="fa-solid fa-trash"></i>
									</button>
								</div>
								<div class="favorite_details">
									Character: ${file.characterName} | Messages: ${file.messageCount}
								</div>
							</div>
						`,
										)
										.join('')
						}
					</div>
				</div>
			</div>
		</div>
	`;

	const result = await callGenericPopup(favoritesTemplate, POPUP_TYPE.TEXT, '', {
		wide: true,
		large: true,
		allowHorizontalScrolling: false,
		allowVerticalScrolling: true,
		okButton: 'Close',
		cancelButton: false,
	});

	// Add event handlers for the popup
	$('.favorites_tab')
		.off('click')
		.on('click', function () {
			const tab = $(this).data('tab');
			$('.favorites_tab').removeClass('active');
			$('.favorites_tab_content').removeClass('active');
			$(this).addClass('active');
			$(`#favorites_${tab}`).addClass('active');
		});

	$('.remove_favorite')
		.off('click')
		.on('click', async function () {
			const type = $(this).data('type');
			const id = $(this).data('id');

			if (type === 'message') {
				settings.favoriteMessages = settings.favoriteMessages.filter(
					(msg) => msg.id !== id,
				);
			} else if (type === 'chatfile') {
				settings.favoriteChatFiles = settings.favoriteChatFiles.filter(
					(file) => file.id !== id,
				);
			}

			await saveSettings();
			$(this).closest('.favorite_item').remove();

			// Update star buttons in the current view
			addStarButtonsToAllMessages();
			addStarButtonToChatFiles();
		});
}

/**
 * Add favorites button to extensions menu
 */
function addFavoritesMenuButton() {
	const favoritesButton = `
		<div id="favorites_menu_button" class="list-group-item flex-container flexGap5">
			<div class="fa-solid fa-star extensionsMenuExtensionIcon"></div>
			<span>Favorites</span>
		</div>
	`;

	// Add to extensions menu
	$('#extensionsMenu').append(favoritesButton);

	// Add click handler
	$('#favorites_menu_button')
		.off('click')
		.on('click', function () {
			showFavoritesWindow();
		});
}

/**
 * Initialize the extension
 */
function init() {
	console.log(`[${EXTENSION_NAME}] Initializing...`);

	// Initialize settings
	initializeSettings();

	// Add favorites menu button
	addFavoritesMenuButton();

	// Add event listeners for message rendering
	eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId) => {
		setTimeout(() => addStarButtonToMessage(messageId), 100);
	});
	eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
		setTimeout(() => addStarButtonToMessage(messageId), 100);
	});

	// Add star buttons to existing messages when chat loads
	eventSource.on(event_types.CHAT_CHANGED, () => {
		setTimeout(() => {
			addStarButtonsToAllMessages();
		}, 500);
	});

	// Add star buttons to chat files when the selection interface is shown
	// We'll use a MutationObserver to detect when chat selection UI is loaded
	const observer = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			mutation.addedNodes.forEach((node) => {
				if (node.nodeType === Node.ELEMENT_NODE) {
					const chatBlocks = $(node).find('.select_chat_block_wrapper');
					if (chatBlocks.length > 0) {
						setTimeout(() => addStarButtonToChatFiles(), 100);
					}
				}
			});
		});
	});

	// Start observing
	observer.observe(document.body, { childList: true, subtree: true });

	console.log(`[${EXTENSION_NAME}] Initialized successfully`);
}

// Initialize when DOM is ready
jQuery(() => {
	init();
});