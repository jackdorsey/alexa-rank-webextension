/*
 * Alexa rank webextension
 * Author: Maksym Stefanchuk <objectivem@gmail.com>
 * Date: 2017-12-05
 *
 */
"use strict";

// Update when background.js is run
var activeTabsPromise = browser.tabs.query({active: true, currentWindow: true});
Promise.all([activeTabsPromise, getOptions()]).then(res => {
  var tabs = res[0];
  var options = res[1];
  updateStatsForTab(tabs[0].id, options)
})

// Listen to events when tab is updated
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  console.log("tabs.onUpdated", tabId, changeInfo, tab);
  if (tab.active) {
    return getOptions().then(options => updateStatsForTab(tabId, options))
  }
  //if (!changeInfo.url) {
  //  return;
  //}
  //var gettingActiveTab = browser.tabs.query({active: true, currentWindow: true});
  //gettingActiveTab.then((tabs) => {
  //  if (tabId == tabs[0].id) {
  //    restartAlarm(tabId);
  //  }
  //});
})

// Listen to events when new tab becomes active
browser.tabs.onActivated.addListener((activeInfo) => {
  console.log("tab.onActivated", activeInfo)
  //restartAlarm(activeInfo.tabId);
  //updateStatsForTab(activeInfo.tabId)
  return getOptions().then(options => updateStatsForTab(activeInfo.tabId, options))
});

// Listen when options change
//browser.storage.onChanged.addListener((changedInfo) => {
//  console.log("options changed:", changedInfo)
//})


function shouldShowForUrl(url) {
  var servicePageRegex = new RegExp("^about:");
  var ipRegex = new RegExp("\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}");
  var regexes = [servicePageRegex, ipRegex];
  if (!url) {
    return false
  }
  var matches = regexes.map(regex => regex.test(url))
  return matches.filter(m => m).length === 0
}

function handleMessage(request, sender) {
  console.log("Received message:", request);
  if (request.message !== "get_alexa_stats") {
    return Promise.resolve({})
  }
  //console.log("sender: ", sender);
  //sendResponse({response: "Response from background script"});

  var tabId = request.tabId;
  var tabPromise = browser.tabs.get(tabId);
  return tabPromise.then(tab => {
    if (!tab.url || !shouldShowForUrl(tab.url)) {
      return Promise.resolve({})
    }
    else {
      var host = getHostnameFromUrl(tab.url)
      return getAlexaStatsCached(host)
        .then(stats => {
          return Object.assign({}, stats, { host: host })
        })
    }
  })
}
browser.runtime.onMessage.addListener(handleMessage);


function updateStatsForTab(tabId, options) {
  var tabPromise = browser.tabs.get(tabId);
  return tabPromise.then(tab => {
    //console.log(tab);
    if (!tab.url || !shouldShowForUrl(tab.url)) {
      //console.log("Not webpage")
      browser.pageAction.hide(tabId);
    }
    else {
      var host = getHostnameFromUrl(tab.url)
      //console.log("host:", host)

      return getAlexaStatsCached(host).then(stats => {
        return getIconImageData(stats, options).then(imageData => {
          browser.pageAction.setIcon({
            imageData: imageData,
            tabId: tabId
          })
          browser.pageAction.show(tabId);
        })
      })
      .catch(error => {
        console.log(error)
        browser.pageAction.hide(tabId)
      })
    }
  })
}

function getIconImageData(stats, options) {
  var imageWidth = 32;
  var imageHeight = 32;
  var markerSize = 8;
  var font = "bold 15pt 'Arial'";
  var rank = stats.rank !== null ? parseInt(stats.rank) : null;
  var color = options.addressbar_text_color ? options.addressbar_text_color : "#444";

  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');

  var addText = (ctx, text, centerX, centerY) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    var maxWidth = imageWidth
    ctx.fillText(text, centerX, centerY, maxWidth);
  }

  var shortTextForNumber = (number) => {
    if (number < 1000) {
      return number.toString()
    }
    else if (number < 100000) {
      return Math.floor(number / 1000).toString() + "k"
    }
    else if (number < 1000000) {
      return Math.floor(number / 100000).toString() + "hk"
    }
    else {
      return Math.floor(number / 1000000).toString() + "m"
    }
  }

  var textOffset = 2; // trying to align text beautifully here
  var text = rank !== null ? shortTextForNumber(rank) : "n/a";
  addText(ctx, text, imageWidth / 2, imageHeight / 2 + textOffset)

  return new Promise((resolve, reject) => {
    try {
      var imageData = ctx.getImageData(0, 0, imageWidth, imageHeight);
      //console.log("image data:", imageData);
      resolve(imageData)
    }
    catch (e) {
      reject(e)
    }
  })
}


function getOptions() {
  return browser.storage.local.get("addressbar_text_color")
}


function getHostnameFromUrl(url) {
  var a = document.createElement("a");
  a.href = url;
  return a.hostname;
}


var alexaCache = {};
function getAlexaStatsCached(host) {
  var stats = alexaCache[host];
  if (stats) {
    console.log("Got Alexa stats from cache:", stats)
    return Promise.resolve(stats)
  }
  else {
    return getAlexaStatsFromApi(host).then(stats => {
      console.log("Got Alexa stats from api:", stats)
      alexaCache[host] = stats
      return stats
    })
  }
}

var useHtml = false; //Fix for IPs that are blocked on xml.alexa.com

function getAlexaStatsFromApi(host) {
  if (useHtml) return getAlexaStatsFromHtml(host);
	
  return new Promise((resolve, reject) => {
    var url = "http://xml.alexa.com/data?cli=10&dat=nsa&url=" + host;
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true); // true for asynchronous
    xhr.onreadystatechange = () => {
      if (xhr.readyState == XMLHttpRequest.DONE && xhr.status == 200) {
        //console.log(xhr.responseText);
		
		if (xhr.responseText == "Okay") {
		  useHtml = true;
          return getAlexaStatsFromHtml(host);
		}
			
        var responseXML = xhr.responseXML;
        var rootElement = responseXML.documentElement;

        if (!rootElement || "parseerror" == rootElement.tagName) {
          reject("Alexa info unavailable");
		  useHtml = true;
          return
        }

        var popularityTag   = rootElement.getElementsByTagName('POPULARITY')[0];
        var reachTag        = rootElement.getElementsByTagName('REACH')[0];
        var rankTag         = rootElement.getElementsByTagName('RANK')[0];
        var countryTag      = rootElement.getElementsByTagName('COUNTRY')[0];

        if (!popularityTag) {
          resolve({
            rank: null
          })
          return
        }

        var stats = {
          rank:         popularityTag.getAttribute('TEXT'),
          reach:        reachTag ? reachTag.getAttribute('RANK') : null,
          rankDelta:    rankTag ? rankTag.getAttribute('DELTA') : null,
          countryCode:  countryTag ? countryTag.getAttribute('CODE') : null,
          countryName:  countryTag ? countryTag.getAttribute('NAME') : null,
          countryRank:  countryTag ? countryTag.getAttribute('RANK') : null
        }
        resolve(stats)
      }
      else if (xhr.readyState == XMLHttpRequest.DONE) {
        reject("Request failed")
      }
    }
    xhr.send();
  })
}


function getAlexaStatsFromHtml(host) {
  console.log("getAlexaStatsFromHtml");

  return new Promise((resolve, reject) => {
    var url = "https://www.alexa.com/minisiteinfo/" + host;
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true); // true for asynchronous
    xhr.onreadystatechange = () => {
      if (xhr.readyState == XMLHttpRequest.DONE && xhr.status == 200) {
        //console.log(xhr.responseText);

		var html = new DOMParser().parseFromString(xhr.responseText, "text/html");

        var popularityTag   = html.getElementsByClassName( 'data down' )[0].getElementsByTagName('a')[0].textContent
		popularityTag = popularityTag.replace(",", "");
		
        var reachTag        = 0;
        var rankTag         = 0;
		
        var countryCode      = html.getElementsByClassName('label')[1].childNodes[1].textContent
        //console.log('countryCode:',countryCode);
		
        var countryName = html.getElementsByClassName('label')[1].childNodes[1].getAttribute("title");
        //console.log('countryName:',countryName);
		
		var countryRank = html.getElementsByClassName('data')[1].textContent
		countryRank = countryRank.replace(",", "");
        //console.log('countryRank:',countryRank);
		
		var linksCount = html.getElementsByClassName('data')[2].textContent;
		linksCount = linksCount.replace(",", "");
        //console.log('linksCount:',linksCount);

		if (typeof popularityTag === 'undefined' || popularityTag === null) {
          resolve({
            rank: null
          })
          return
        }

        var stats = {
          rank:         popularityTag,
          reach:        reachTag ? reachTag : null,
          rankDelta:    rankTag ? rankTag : null,
          countryCode:  countryCode,
          countryName:  countryName,
          countryRank:  countryRank,
		  linksCount: 	linksCount
        }
        resolve(stats)
        //console.log('Done:',popularityTag);
		
      }
      else if (xhr.readyState == XMLHttpRequest.DONE) {
        reject("Request failed")
      }
    }
    xhr.send();
  })
}
