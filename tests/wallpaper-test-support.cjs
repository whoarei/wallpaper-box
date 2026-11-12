// Exercise the same production initialization factory as the native host.
function bootstrap(source, mode = 'desktop') {
  return '(' + source + ')(' + JSON.stringify({mode}) + ');' +
    'window.__aquariumFeedBeforeReady=window.__SCREEN_GARDEN_INVOKE_ACTION({' +
    'protocolVersion:1,instanceId:wallpaperHost.instanceId,requestId:"loading",actionId:"feed"}).result;' +
    'document.addEventListener("DOMContentLoaded",()=>window.__SCREEN_GARDEN_SET_PAUSED(' +
    '{paused:false,pauseReason:"none"}),{once:true});';
}
module.exports = {bootstrap};
