/**
 * Shared vocabulary of the sidebar's HTML preview surfaces (the editor's
 * html viewer and the changes tab's op render preview): the sandbox tokens
 * both preview iframes load with.
 */

/**
 * The sandbox tokens of an HTML preview iframe. NO allow-same-origin (the
 * preview must stay in an opaque origin — with the route's own origin it
 * could read session data) and NO allow-top-navigation (a previewed page
 * must not hijack the GUI). Both preview surfaces keep these tokens fixed;
 * persisted legacy unsafe preferences cannot change this boundary.
 */
export const HTML_IFRAME_SANDBOX = 'allow-scripts allow-popups allow-downloads allow-modals'
