/**
 * Applies default Telegram API options.
 *
 * - Sets parse_mode to HTML if not provided
 * - Disables link previews for text messages
 *
 * Used inside grammy api middleware.
 */
export function applyDefaults(method: string, payload: any): void {
    if (!payload || typeof payload !== "object") {
        return;
    }

    if (!payload.parse_mode) {
        payload.parse_mode = "HTML";
    }

    if (
        (method === "sendMessage" || method === "editMessageText") &&
        !payload.link_preview_options
    ) {
        payload.link_preview_options = { is_disabled: true };
    }
}
