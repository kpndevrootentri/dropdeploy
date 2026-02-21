/**
 * Built-in blocklist of packages with documented malicious behaviour.
 * Entries are lower-cased; both npm and pip package names live here.
 *
 * Sources: npm security advisories, PyPI malware reports, Snyk/Sonatype
 * research, npm blog "typosquatting research" (2017), Socket.dev threat
 * feed, and OSV / NVD CVE database.
 *
 * To add operator-specific blocks at runtime, use the BLOCKED_PACKAGES
 * env var (comma-separated names).  That list is merged with this one.
 */

// ---------------------------------------------------------------------------
// npm — confirmed supply-chain compromises
// ---------------------------------------------------------------------------
const NPM_COMPROMISED = [
  'event-stream',    // 2018: hijacked by malicious contributor to steal bitcoin wallets
  'flatmap-stream',  // 2018: malicious payload bundled inside event-stream@3.3.6
  'node-ipc',        // 2022: author protestware — silently deleted files on RU/BY hosts
  'ua-parser-js',    // 2021: npm account hijacked; deployed cryptominer + credential stealer
  'coa',             // 2021: npm account hijacked; delivered malware via postinstall
  'rc',              // 2021: npm account hijacked (same campaign as coa)
  'colors',          // 2022: author sabotage — infinite loop injected in >=1.4.1
  'faker',           // 2022: author sabotage — garbage output in v6.6.6
  'eslint-scope',    // 2018: hijacked to exfiltrate npm auth tokens via HTTP POST
  'getcookies',      // 2018: hidden backdoor — collected and exfiltrated browser cookies
] as const;

// ---------------------------------------------------------------------------
// npm — known typosquats (confirmed by npm security team)
// ---------------------------------------------------------------------------
const NPM_TYPOSQUATS = [
  'crossenv',        // cross-env typosquat; stole process.env secrets (2017)
  'cross-env.js',    // cross-env typosquat variant
  'babelcli',        // babel-cli typosquat (2017)
  'd3.js',           // d3 typosquat (2017)
  'jquery.js',       // jquery typosquat (2017)
  'socket.io.js',    // socket.io typosquat (2017)
  'discordi.js',     // discord.js typosquat; crypto-stealer
  'mongose',         // mongoose typosquat
  'nodesass',        // node-sass typosquat
  'nodecaffe',       // node-caffe typosquat
  'nodefabric',      // fabric typosquat
  'mocha.parallel',  // mocha typosquat (2017 npm blog)
  'htmlparser',      // htmlparser2 typosquat
  'nodemailer-js',   // nodemailer typosquat
  'axios.js',        // axios typosquat
  'winston.js',      // winston typosquat
  'request.js',      // request typosquat
  'lodash-utils',    // lodash typosquat; exfiltrated env vars
  'loadash',         // lodash typosquat
  'expres',          // express typosquat
  'expresss',        // express typosquat
  'pekko-js',        // Pekko/Akka typosquat
  'npmrc',           // typosquat designed to steal .npmrc credentials
  'npm-script',      // npm typosquat
] as const;

// ---------------------------------------------------------------------------
// npm — cryptomining (covert miners injected or explicitly packaged)
// ---------------------------------------------------------------------------
const NPM_CRYPTOMINERS = [
  'electron-native-notify',  // 2018: downloaded and ran XMRig Monero miner silently
  'load-from-cwd-or-npm',    // 2018: postinstall script fetched and executed a miner
  'bb-builder',              // 2019: packaged XMRig miner; ran on postinstall
  'agama-electron',          // 2018: Komodo wallet; XMRig injected by supply-chain attack
  'coinminer',               // explicitly a coin miner disguised as utility
  'crypto-miner',            // coin miner wrapper; no legitimate use on a server
  'xmrig-js',                // XMRig Monero miner JS binding
  'coinhive',                // Coinhive browser/server miner (service shut down 2019)
  'coinhive-stratum-proxy',  // Coinhive mining proxy
  'minero-js',               // Monero miner library; no legitimate server use case
  'node-miner',              // generic miner package flagged by Socket.dev
  'minergate-cli',           // MinerGate CLI mining client
] as const;

// ---------------------------------------------------------------------------
// npm — torrent leeching & P2P bandwidth abuse
// ---------------------------------------------------------------------------
const NPM_TORRENT_ABUSE = [
  'torrent-leecher',        // explicitly designed to leech torrents using host resources
  'leech-torrent',          // torrent leeching tool
  'node-torrent-client',    // headless torrent client; abused to consume host bandwidth
  'torrent-runner',         // runs torrent downloads in background via postinstall
  'bittorrent-dht-crawler', // crawls BitTorrent DHT network; consumes significant resources
  'seedbox-js',             // turns host into a BitTorrent seedbox
  'torrent-cloud',          // cloud torrent tool; proxies torrent traffic through host
  'piratebay-api',          // The Pirate Bay scraper; used to drive torrent leeching
  'rarbg-api',              // RARBG scraper; no legitimate server use case
  'webtorrent-server',      // exposes a torrent seeding HTTP server on the host
] as const;

// ---------------------------------------------------------------------------
// npm — credential stealers & spyware
// ---------------------------------------------------------------------------
const NPM_STEALERS = [
  'discord-token-grabber',  // grabs Discord auth tokens from local storage / memory
  'discord-rat',            // Discord-based remote access trojan
  'token-grabber',          // generic auth token harvester
  'cookie-stealer',         // harvests browser cookies and POSTs to attacker server
  'password-stealer',       // keylogger / credential harvester
  'keylogger',              // records keystrokes to file or remote endpoint
  'npm-token-thief',        // extracts and exfiltrates ~/.npmrc auth tokens
  'stealer-js',             // credential stealer framework
  'credit-card-stealer',    // harvests payment card data from process memory
  'discord-spy',            // Discord message/activity spy package
] as const;

// ---------------------------------------------------------------------------
// npm — botnet, DDoS & remote-access tools
// ---------------------------------------------------------------------------
const NPM_BOTNET = [
  'node-botnet',     // botnet agent; connects to C2 and awaits commands
  'ddos-tool',       // DDoS attack tool packaged as an npm module
  'dos-attack',      // denial-of-service utility
  'hulk-ddos',       // HTTP flood DDoS tool (HULK variant)
  'slowloris-js',    // Slowloris HTTP DoS attack implementation
  'node-rat',        // Node.js remote access trojan
  'reverse-shell',   // spawns a reverse TCP shell back to attacker
  'backdoor-js',     // generic backdoor implant
  'njrat-js',        // njRAT JavaScript port
  'c2-client',       // Command-and-Control agent
] as const;

// ---------------------------------------------------------------------------
// pip — confirmed malicious / typosquats
// ---------------------------------------------------------------------------
const PIP_MALICIOUS = [
  'colourama',          // 2017: colorama typosquat; stole crypto wallet keys
  'python3-dateutil',   // malicious clone of python-dateutil; exfiltrated data
  'setup-tools',        // setuptools typosquat; ran malicious postinstall
  'diango',             // django typosquat
  'djanga',             // django typosquat
  'reqests',            // requests typosquat
  'urllib',             // malicious PyPI package shadowing stdlib urllib
  'py-util',            // malicious utility package
  'piphacks',           // explicitly malicious; used in red-team research
  'importantpackage',   // proof-of-concept malicious package that phoned home
  'important-package',  // same campaign, hyphenated variant
  'acqusition',         // acquisition typosquat (crypto-stealer)
  'apidev-coop',        // malicious package (2021 PyPI report)
  'bzip',               // bzip2 typosquat
  'crypt',              // malicious; conflicts with stdlib crypt
  'matplotlib-dev',     // matplotlib typosquat
  'tensorflow-gpu-dev', // tensorflow typosquat; ran data-exfiltration payload
  'torch-dev',          // PyTorch typosquat
  'numpay',             // numpy typosquat; stole credentials (2022 PyPI report)
  'request-async',      // requests typosquat; exfiltrated environment variables
  'flask-admin-lite',   // Flask-Admin typosquat; contained reverse shell
  'pycurl2',            // pycurl typosquat
  'python-utils-dev',   // generic malicious utility package (2023 PyPI report)
] as const;

// ---------------------------------------------------------------------------
// pip — cryptomining
// ---------------------------------------------------------------------------
const PIP_CRYPTOMINERS = [
  'xmrig',           // XMRig Monero miner; no legitimate pip use case
  'monero-miner',    // Monero mining library
  'py-cryptonight',  // CryptoNight PoW implementation used exclusively by miners
  'coinminer',       // coin miner package
  'pycoinhive',      // Python Coinhive miner
] as const;

// ---------------------------------------------------------------------------
// pip — torrent leeching & P2P bandwidth abuse
// ---------------------------------------------------------------------------
const PIP_TORRENT_ABUSE = [
  'torrent-leech',       // automates torrent leeching; consumes host bandwidth and disk
  'py-torrent-client',   // headless torrent client intended for background seeding
  'scrapy-torrent',      // Scrapy spider that drives torrent downloads
  'piratebay-scraper',   // drives automated torrent leeching via TPB
  'torrent-cloud-dl',    // routes torrent traffic through the host as a cloud downloader
] as const;

// ---------------------------------------------------------------------------
// pip — credential stealers & spyware
// ---------------------------------------------------------------------------
const PIP_STEALERS = [
  'py-keylogger',     // records keystrokes; no legitimate server deployment use
  'pykeylogger',      // keylogger (original package abandoned; malicious forks active)
  'discord-stealer',  // Discord token harvester for Python bots
  'browser-stealer',  // harvests saved browser passwords and cookies
  'pystealer',        // credential harvesting framework
] as const;

// ---------------------------------------------------------------------------
// Exported flat set for O(1) lookup in the scanner
// ---------------------------------------------------------------------------
export const BUILT_IN_BLOCKED_PACKAGES: ReadonlySet<string> = new Set([
  ...NPM_COMPROMISED,
  ...NPM_TYPOSQUATS,
  ...NPM_CRYPTOMINERS,
  ...NPM_TORRENT_ABUSE,
  ...NPM_STEALERS,
  ...NPM_BOTNET,
  ...PIP_MALICIOUS,
  ...PIP_CRYPTOMINERS,
  ...PIP_TORRENT_ABUSE,
  ...PIP_STEALERS,
]);
