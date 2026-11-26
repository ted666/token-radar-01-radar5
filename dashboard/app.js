// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The value model, in one place, so the page and the board agree: a protocol's implied value is its
// TVL times exp of a fitted log ratio — its category's shrunk mean log market-cap-per-TVL, plus
// an intercept and five fitted terms in log TVL, seven-day growth, the rise of the first year of
// age and the fall after it, and the extra chains. The fit is read from the snapshot's own live
// tokens and tested held out three ways; the model strip under the lede shows the fitted
// coefficients and the held-out lifts, and the model panel below the board shows the full fit.
// The page recomputes a row from its stored log ratio and checks the number board.json carries,
// so the page's code and the board's data are visibly the same arithmetic. No protocol name is
// special-cased, and no row is hand-picked.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the log ratio board.json
  // carries, with the same ratio clamp the board was built with, so the page's code and
  // the board's data are visibly the same arithmetic. The six factors the detail view
  // shows multiply to the same ratio; the log ratio is stored so the check is exact.
  function impliedOf(row, model) {
    var ratio = Math.min(model.multiple_cap, Math.max(model.multiple_floor, Math.exp(row.log_ratio)));
    return Math.max(1, Math.round(row.tvl_usd * ratio));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: the wallet and the gas follow
  // the protocol's chains, the capital follows its TVL, the hold follows its age, and the actions
  // follow its category. The readiness step sizes and times the position from how long the protocol
  // has run with no token and how fast its TVL is moving. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    if (chain === 'Ethereum') return '$8';
    if (chain === 'Solana') return '$0.10';
    var cheap = ['Arbitrum', 'Optimism', 'Base', 'Polygon', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mantle', 'Mode', 'Gnosis', 'Starknet', 'Celo', 'Fantom'];
    if (cheap.indexOf(chain) >= 0) return '$1';
    return '$2';
  }
  // What one transaction costs on a chain, as a number, for the verdict's totals.
  function gasNumFor(chain) {
    if (chain === 'Ethereum') return 8;
    if (chain === 'Solana') return 0.1;
    var cheap = ['Arbitrum', 'Optimism', 'Base', 'Polygon', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mantle', 'Mode', 'Gnosis', 'Starknet', 'Celo', 'Fantom'];
    if (cheap.indexOf(chain) >= 0) return 1;
    return 2;
  }
  // A dollar figure as a short string: $12.4M, $124K, $56, $0.70 — the same shape the board uses.
  function moneyStr(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    if (n === Math.round(n)) return '$' + n;
    return '$' + n.toFixed(2);
  }
  function isEvmChain(chain) {
    return ['Ethereum', 'Arbitrum', 'Optimism', 'Base', 'Polygon', 'Avalanche', 'Binance', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mantle', 'Mode', 'Gnosis', 'Starknet', 'Celo', 'Fantom', 'Monad', 'Berachain', 'Sonic', 'Hyperliquid L1'].indexOf(chain) >= 0;
  }
  function walletStep(chain) {
    if (chain === 'Solana') return 'Set up a fresh Solana wallet (Phantom or Solflare) that holds only the funds you plan to farm, and keep its seed phrase offline.';
    if (isEvmChain(chain)) return 'Set up a fresh EVM wallet that holds only the funds you plan to farm, and keep its seed phrase offline.';
    return 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' as collateral and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Provide $' + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + capital + " of USDC into " + name + "'s highest-TVL vault on " + chain + ' and keep the shares.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('risk curat') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + " of USDC into " + name + "'s basis vault on " + chain + ' and keep the position.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('stable') >= 0 || c.indexOf('algo-stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC onto ' + chain + " and use it in the chain's flagship app.";
    if (c.indexOf('launchpad') >= 0) return 'Stake $' + capital + " to join " + name + "'s next sale on " + chain + '.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Spend $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipts.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold it.';
    if (c.indexOf('nft') >= 0) return 'List or buy one item through ' + name + ' on ' + chain + '.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + " in " + name + "'s governance on " + chain + ' and vote.';
    if (c.indexOf('privacy') >= 0) return 'Use $' + capital + " through " + name + "'s private pool on " + chain + '.';
    if (c.indexOf('ai') >= 0) return 'Deposit $' + capital + " into " + name + "'s compute pool on " + chain + '.';
    if (c.indexOf('otc') >= 0) return 'Place one $' + capital + ' quote through ' + name + ' on ' + chain + '.';
    if (c.indexOf('token locker') >= 0) return 'Lock $' + capital + ' of tokens through ' + name + ' on ' + chain + '.';
    if (c.indexOf('reserve') >= 0) return 'Deposit $' + capital + " into " + name + "'s reserve on " + chain + '.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the collateral and repay it the same week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Swap a small amount through the pool and adjust the range once.';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return "Claim the vault's yield and redeposit it.";
    if (c.indexOf('rwa') >= 0) return "Claim the asset's yield and hold the receipt.";
    if (c.indexOf('risk curat') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Move a small amount into a second vault the curator runs.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'Open and close one small position.';
    if (c.indexOf('basis') >= 0) return 'Check the funding rate and rebalance once.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake the staking rewards once.';
    if (c.indexOf('stable') >= 0 || c.indexOf('algo-stable') >= 0) return 'Mint and redeem a small amount to show both sides.';
    if (c.indexOf('prediction') >= 0) return 'Settle one position and open another.';
    if (c.indexOf('insurance') >= 0) return "Check the cover's terms and renew if it lapses.";
    if (c.indexOf('chain') >= 0) return 'Make one transaction on the chain each week.';
    if (c.indexOf('launchpad') >= 0) return 'Vote on one sale proposal.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Make one payment a week.';
    if (c.indexOf('index') >= 0) return 'Rebalance a small amount into the index.';
    if (c.indexOf('nft') >= 0) return 'Make one marketplace action a week.';
    if (c.indexOf('governance') >= 0) return 'Vote on one proposal a week.';
    if (c.indexOf('privacy') >= 0) return 'Make one shielded transaction a week.';
    if (c.indexOf('ai') >= 0) return 'Run one job through the pool.';
    if (c.indexOf('otc') >= 0) return 'Settle one trade a week.';
    if (c.indexOf('token locker') >= 0) return 'Check the lock schedule.';
    if (c.indexOf('reserve') >= 0) return 'Check the reserve ratio.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a small amount back the other way.';
    return 'Make one qualifying action each week, such as a deposit, a swap or a vote.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function growthStr(change7d) {
    var g = change7d === null || change7d === undefined || !isFinite(change7d) ? 0 : change7d;
    return (g > 0 ? '+' : '') + g.toFixed(1) + '%';
  }
  // The readiness step: how to size and time the position, from the protocol's own figures. A
  // young protocol with fast-growing TVL is an early, competitive window; a young one with flat
  // TVL is early but unproven; a protocol that has run three years with no token may never launch
  // one; an established one with growing TVL is about the size of the distribution, and a flat
  // one is a slow farm. The same branches score every protocol. These branches are about launch
  // timing, not about the value model: the fitted age terms are nearly flat, so the market does
  // not pay much for age once size is controlled, but a three-year-old protocol with no token
  // is still a timing long shot.
  function readinessStep(p, capital) {
    var age = p.age_days;
    var growth = p.change_7d === null || p.change_7d === undefined || !isFinite(p.change_7d) ? 0 : p.change_7d;
    var half = capital / 2;
    if (age === null || age === undefined) {
      return { text: "The protocol's listing date is not recorded, so its age is unknown — size the position at the usual $" + capital + ' and watch its TVL for a few weeks before adding more.', cost: 'no fee to decide', time: '5 minutes' };
    }
    if (age < 180 && growth > 20) {
      return { text: 'The protocol is young (' + age + ' days listed) and its TVL is growing fast (' + growthStr(p.change_7d) + ' in 7 days) — the window is early and competitive. Set up the position this week at the full $' + capital + '.', cost: 'the $' + capital + ' stays in the position', time: '5 minutes' };
    }
    if (age < 180) {
      return { text: 'The protocol is young (' + age + ' days listed) but its TVL is flat or falling (' + growthStr(p.change_7d) + ' in 7 days) — the window is early but unproven. Start at half the usual amount, $' + half + ', and add more only if the TVL turns up.', cost: 'the $' + half + ' stays in the position', time: '5 minutes' };
    }
    if (age >= 1095) {
      return { text: 'The protocol has run ' + age + ' days with no token — it may never launch one. Keep the position small, $' + capital + ' at most, and treat it as a long shot.', cost: 'the $' + capital + ' stays in the position', time: '5 minutes' };
    }
    if (growth > 10) {
      return { text: 'The protocol has run ' + age + ' days and its TVL is growing (' + growthStr(p.change_7d) + ' in 7 days) — the position is about the size of the future distribution, not about being early. Use the full $' + capital + ' and hold for the full window.', cost: 'the $' + capital + ' stays in the position', time: '5 minutes' };
    }
    return { text: 'The protocol has run ' + age + ' days with its TVL roughly flat (' + growthStr(p.change_7d) + ' in 7 days) — a launch, if it comes, is not imminent. Use $' + capital + ' and treat the position as a slow farm, not a sprint.', cost: 'the $' + capital + ' stays in the position', time: '5 minutes' };
  }
  function tvlStr(tvl) {
    if (tvl >= 1e9) return '$' + (tvl / 1e9).toFixed(2) + 'B';
    if (tvl >= 1e6) return '$' + (tvl / 1e6).toFixed(1) + 'M';
    return '$' + Math.round(tvl / 1e3) + 'K';
  }
  // The numbers-check step: the protocol's own figures, re-checked weekly. It replaces the old
  // points-page step, which assumed a rewards page exists that the snapshot never records.
  function numbersCheckStep(p) {
    var age = p.age_days;
    var ageText = age === null || age === undefined ? 'its listing date is not recorded' : 'it has run ' + age + ' days with no token';
    return { text: 'This week the protocol holds ' + tvlStr(p.tvl_usd) + ' of TVL, ' + growthStr(p.change_7d) + ' in 7 days, and ' + ageText + '. Re-check those three numbers every week; if TVL falls two weeks running, unwind the position.', cost: 'no fee to check', time: '5 minutes a week' };
  }
  function watchFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'watch the borrow rate and the collateral ratio';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return "watch the pool's fees and the price range";
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return "watch the vault's yield and its TVL";
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'watch the unbonding period and the staking yield';
    if (c.indexOf('stable') >= 0 || c.indexOf('algo-stable') >= 0) return 'watch the peg every day';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'watch the funding rate and the liquidation price';
    if (c.indexOf('rwa') >= 0) return "watch the underlying asset's yield";
    if (c.indexOf('basis') >= 0) return 'watch the funding rate';
    return 'watch the TVL';
  }
  function holdStep(p, capital, hold) {
    return { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and ' + watchFor(p) + ' while you hold it.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' };
  }
  function claimStep(p) {
    if (p.chains && p.chains.length > 1) {
      return { text: "Before you withdraw, check the protocol's own announcements for a claim link on each chain you used, and claim on the chain where the position is largest first. Use only a link the protocol itself publishes, and never pay anyone to claim.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' };
    }
    return { text: "Before you withdraw, check the protocol's own announcements for a claim link and use only the link it publishes. Never pay anyone to claim, and never connect the wallet to a link from a reply or a direct message.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' };
  }
  function logStep(p) {
    var age = p.age_days;
    var ageText = age === null || age === undefined ? 'listing date not recorded' : age + ' days listed';
    // The chains list is capped at twelve names so this step never crowds the gate's 600-character
    // cap, however many chains a protocol lives on; the count keeps the record complete.
    var chains = 'one chain';
    if (p.chains && p.chains.length) {
      chains = p.chains.length > 12 ? p.chains.slice(0, 12).join(', ') + ' and ' + (p.chains.length - 12) + ' more' : p.chains.join(', ');
    }
    return { text: 'Write the wallet, the dates, the entry TVL (' + tvlStr(p.tvl_usd) + '), the 7-day growth (' + growthStr(p.change_7d) + '), the age (' + ageText + '), the chains (' + chains + ') and every transaction hash in a farm log, so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' };
  }
  function riskStep(p, capital) {
    var c = (p.category || '').toLowerCase();
    var atRisk = Math.round(capital * 0.2);
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) {
      return { text: 'The main risk is impermanent loss on the pair and slippage on entry and exit: size the position so a 20% move against you costs at most $' + atRisk + ', and set slippage to 0.5% on every swap.', cost: 'the $' + capital + ' stays at risk', time: '10 minutes to check' };
    }
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) {
      return { text: 'The main risk is liquidation if the collateral falls: keep the loan-to-value below 50% so a 30% drop does not liquidate the $' + capital + ' position.', cost: 'the $' + capital + ' stays at risk', time: '10 minutes to check' };
    }
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) {
      return { text: "The main risk is the vault's strategy changing or its underlying protocol failing: the $" + capital + " is exposed to the vault's contracts, so check the vault's audits and TVL every week.", cost: 'the $' + capital + ' stays at risk', time: '10 minutes a week' };
    }
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) {
      return { text: 'The main risk is slashing and the unbonding wait: unstaking takes days, so the $' + capital + ' is locked until the unbonding period ends — check that period before you stake.', cost: 'the $' + capital + ' stays at risk', time: '10 minutes to check' };
    }
    if (c.indexOf('stable') >= 0 || c.indexOf('algo-stable') >= 0) {
      return { text: 'The main risk is a depeg: the stable asset can trade below $1, so watch the peg daily and exit if it slips more than 2%.', cost: 'the $' + capital + ' stays at risk', time: '5 minutes a day' };
    }
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) {
      return { text: 'The main risk is liquidation on leverage: keep leverage at 1x so the $' + capital + ' of margin covers a 20% move against you.', cost: 'the $' + capital + ' stays at risk', time: '10 minutes to check' };
    }
    return { text: 'The main risk is the protocol\'s contracts: the $' + capital + ' is exposed to code you did not audit, so keep the position small and check the protocol\'s audits before adding more.', cost: 'the $' + capital + ' stays at risk', time: '10 minutes to check' };
  }
  function exitStep(p, capital, gas) {
    var second = p.chains && p.chains.length > 1 ? ' Close the second-chain position first, then the main one.' : '';
    return { text: 'To unwind, withdraw in reverse order: close the weekly position first, then the main position.' + second + ' Exit if the TVL falls two weeks running, or when the token launches and the claim opens.', cost: 'about ' + gas + ' of gas per withdrawal', time: '15 minutes' };
  }
  // The verdict step: the whole plan costed to one line — the same derivation main.ts
  // writes to board.json, so the page's plan and the board's plan are identical. The gas
  // is the entry transaction plus one a week for the hold plus one withdrawal per chain
  // used; the attention is the setup, the weekly actions, the checks, the claim, the log
  // and the risk check; the implied value per $1 of capital is the model's implied value
  // divided by the capital; the minimum viable capital is twice the gas, floored at $25.
  function verdictStep(p) {
    var chain = chainOf(p);
    var gasNum = gasNumFor(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.ceil(hold / 7);
    var withdrawals = p.chains && p.chains.length > 1 ? 2 : 1;
    var totalGas = Math.round(gasNum * (1 + weeks + withdrawals) * 100) / 100;
    var minutes = 55 + 15 * weeks;
    var hours = (minutes / 60).toFixed(1);
    var perDollar = Math.round(p.implied_value_usd / capital);
    var minViable = Math.max(25, Math.ceil(totalGas * 2));
    var clears = capital >= minViable;
    return {
      text: 'Verdict: ' + moneyStr(p.implied_value_usd) + ' of implied value against $' + capital + ' of capital locked and about ' + moneyStr(totalGas) + ' of gas, so about ' + moneyStr(perDollar) + ' of implied value per $1 of capital. The position needs about ' + hours + ' hours of attention over ' + hold + ' days, and at least $' + minViable + ' of capital to be worth the gas — the $' + capital + ' plan ' + (clears ? 'clears' : 'does not clear') + ' that bar.',
      cost: 'about ' + moneyStr(totalGas) + ' of gas, $' + capital + ' locked',
      time: 'about ' + hours + ' hours over ' + hold + ' days'
    };
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var gas = gasFor(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var secondChain = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    return [
      { text: walletStep(chain), cost: 'about ' + gas + ' of gas for the first transaction', time: '5 minutes' },
      readinessStep(p, capital),
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about ' + gas + ' of gas', time: '15 minutes to set up' },
      { text: weeklyFor(p), cost: 'about ' + gas + ' of gas a week', time: '10 minutes a week' },
      secondChain === null
        ? numbersCheckStep(p)
        : { text: 'Use ' + p.name + ' on ' + secondChain + ' too: repeat the main position there with a smaller amount, so the activity counts on two chains.', cost: '$25 of capital and about ' + gasFor(secondChain) + ' of gas', time: '20 minutes' },
      holdStep(p, capital, hold),
      claimStep(p),
      logStep(p),
      riskStep(p, capital),
      exitStep(p, capital, gas),
      verdictStep(p)
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watchlist')) state.watchlistOnly = params.get('watchlist') === '1';
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.watchlistOnly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, screened the same way. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  // The fitted-model strip: the coefficients and the held-out lifts, at the top of the
  // page so the board screenshot carries them. Every number comes from DATA, which
  // main.ts computed from the snapshot — nothing here is typed in by hand.
  function coef(n, d) {
    return (n < 0 ? '- ' : '+ ') + Math.abs(n).toFixed(d === undefined ? 2 : d);
  }
  function modelStrip() {
    var f = DATA.fit;
    var v = DATA.validation;
    return el('section', { class: 'model-strip' },
      el('div', null,
        el('b', { text: 'Fitted model · ' + DATA.model_version + '  ' }),
        el('span', { text: 'log(mcap/TVL) = ' + f.intercept.toFixed(2) + ' ' + coef(f.logtvl) + ' x ln(TVL/$100M) ' + coef(f.growth) + ' x growth ' + coef(f.rise) + ' x rise ' + coef(f.fall) + ' x fall ' + coef(f.chains) + ' x chains, plus a category effect shrunk toward the global mean. Fitted on ' + f.live_count + ' live tokens; growth winsorized to ' + f.growth_min_pct + '% to ' + f.growth_max_pct + '%.' })
      ),
      el('div', null,
        el('b', { text: 'Held out · ' }),
        el('span', { text: 'leave-one-out ' + v.loo.lift_vs_radar4.toFixed(2) + 'x the hand-set model and ' + v.loo.lift_vs_tvl.toFixed(2) + 'x TVL-only (' + v.loo.fitted_mse.toFixed(2) + ' vs ' + v.loo.radar4_mse.toFixed(2) + ' vs ' + v.loo.tvl_mse.toFixed(2) + ' MSE); walk-forward ' + v.walk_forward.lift_vs_radar4.toFixed(2) + 'x / ' + v.walk_forward.lift_vs_tvl.toFixed(2) + 'x; five-fold ' + v.five_fold.lift_vs_radar4.toFixed(2) + 'x / ' + v.five_fold.lift_vs_tvl.toFixed(2) + 'x. In-sample R2 ' + v.r_squared.toFixed(2) + '.' })
      )
    );
  }

  function spotlight() {
    var top = DATA.rows.slice(0, 3);
    return el('section', { class: 'spot', 'aria-label': 'Top three by implied value' },
      top.map(function (r) {
        return el('button', { type: 'button', class: 'spot-card', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: 'Rank ' + r.rank }),
          el('span', { class: 'name', text: r.name }),
          el('span', { class: 'value', text: fmtUsd(r.implied_value_usd) + ' implied' }),
          el('span', { class: 'meta', text: (r.category || 'Other') + ' · ' + fmtUsd(r.tvl_usd) + ' TVL · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'one chain') })
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var watch = el('input', { type: 'checkbox', id: 'watchlist', checked: state.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watch.addEventListener('change', function () { state.watchlistOnly = watch.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('label', { class: 'check', for: 'watchlist' }, watch, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'badge ' + (r.watchlist ? 'watch' : 'early'), text: r.watchlist ? 'watchlist' : 'early' })),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and they are the calibration: their market cap per TVL dollar sets each category multiple.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var f = DATA.fit;
    var v = DATA.validation;
    var calibRows = (DATA.calibration.categories || []).slice().sort(function (a, b) { return b.multiple - a.multiple; });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one fitted function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x exp( category effect ' + coef(f.intercept, 4) + ' ' + coef(f.logtvl, 4) + ' x ln(tvl_usd / $100M) ' + coef(f.growth, 4) + ' x growth ' + coef(f.rise, 4) + ' x rise ' + coef(f.fall, 4) + ' x fall ' + coef(f.chains, 4) + ' x chains ) ), ratio clamped to ' + m.multiple_floor + '–' + m.multiple_cap
      ),
      el('p', { class: 'sub', text: 'The log ratio is ln(market cap / TVL) of a live token, winsorized at ' + m.ratio_cap + '. The category effect is the shrunk mean log ratio of the live tokens in the same category — (sum + ' + m.category_shrinkage_k + ' x global mean) / (n + ' + m.category_shrinkage_k + ') — so one live token can never set a category\u2019s price on its own; a category with no live token uses the global mean of ' + f.global_log_ratio.toFixed(4) + ' outright. Growth is the seven-day change as a fraction, winsorized to ' + f.growth_min_pct + '% to ' + f.growth_max_pct + '%, the range the live tokens actually show. Rise is the first year of age as a fraction of a year, fall the years after it; an unlisted age uses ' + m.unknown_age_days + ' days. Chains counts the extra chains beyond the first, capped at four.' }),
      el('p', { class: 'sub', text: 'Size dominates: a bigger protocol earns a lower multiple per TVL dollar (' + f.logtvl.toFixed(2) + ' per log unit). Growth (' + f.growth.toFixed(2) + ') and age (' + f.rise.toFixed(2) + ' rise, ' + f.fall.toFixed(2) + ' fall) barely move the multiple once size is controlled, and the category sets the level. The readiness step still sizes a farm position by launch timing — young and growing is the early window, three years with no token is a long shot — which is about when to farm, not about the multiple.' }),
      el('h3', { text: 'Held out: the fit tested on protocols it never saw' }),
      el('p', { class: 'sub', text: 'Leave-one-out (' + v.live_count + ' tokens, refit ' + v.live_count + ' times): fitted MSE ' + v.loo.fitted_mse.toFixed(2) + ' against the hand-set model\u2019s ' + v.loo.radar4_mse.toFixed(2) + ' and TVL-only\u2019s ' + v.loo.tvl_mse.toFixed(2) + ' — ' + v.loo.lift_vs_radar4.toFixed(2) + 'x and ' + v.loo.lift_vs_tvl.toFixed(2) + 'x. Five-fold cross-validation (seeded shuffle): ' + v.five_fold.fitted_mse.toFixed(2) + ' vs ' + v.five_fold.radar4_mse.toFixed(2) + ' vs ' + v.five_fold.tvl_mse.toFixed(2) + ' — ' + v.five_fold.lift_vs_radar4.toFixed(2) + 'x and ' + v.five_fold.lift_vs_tvl.toFixed(2) + 'x. Walk-forward (' + v.walk_forward_count + ' tokens with a listing date, chronological quartiles, trained only on earlier listings): ' + v.walk_forward.fitted_mse.toFixed(2) + ' vs ' + v.walk_forward.radar4_mse.toFixed(2) + ' vs ' + v.walk_forward.tvl_mse.toFixed(2) + ' — ' + v.walk_forward.lift_vs_radar4.toFixed(2) + 'x and ' + v.walk_forward.lift_vs_tvl.toFixed(2) + 'x. In-sample R2 ' + v.r_squared.toFixed(2) + ': the log ratio is noisy, and the fit explains only part of it.' }),
      el('p', { class: 'sub', text: 'The early radar is every pre-token protocol below the watchlist floor that passes the same launch screen, and the live-token protocols are set aside with their market caps shown. The board leaves out ' + DATA.excluded_above_floor + ' pre-token protocols at or above the $50M floor that pass the visible screen but are not on the watchlist: the watchlist rule also excludes products of a parent protocol, a record the snapshot does not carry, so the board follows the list rather than overriding it.' }),
      el('h3', { text: 'Calibration: what the market pays per TVL dollar' }),
      el('p', { class: 'sub', text: 'Each category multiple is exp of its fitted category effect; the median beside it is the raw median market cap per TVL dollar of its live tokens, so the shrinkage is visible. Each ratio is winsorized at ' + m.ratio_cap + ' first — a token trading at 400x its TVL is a token whose value comes from volume or fees, not locked value, and must not set a whole category\u2019s price. Multiples are clamped to ' + m.multiple_floor + '–' + m.multiple_cap + '. The global multiple is ' + DATA.calibration.global_multiple + ', from ' + DATA.calibration.live_count + ' live tokens.' }),
      el('div', { class: 'calib-wrap' },
        el('table', { class: 'calib' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', class: 'num', text: 'Live tokens' }),
            el('th', { scope: 'col', class: 'num', text: 'Median mcap / TVL' }),
            el('th', { scope: 'col', class: 'num', text: 'Multiple used' }),
            el('th', { scope: 'col', text: 'Source' })
          )),
          el('tbody', null, calibRows.map(function (c) {
            return el('tr', null,
              el('td', { text: c.category }),
              el('td', { class: 'num', text: String(c.live_count) }),
              el('td', { class: 'num', text: c.median === null ? 'n/a' : String(c.median) }),
              el('td', { class: 'num', text: c.multiple.toFixed(3) }),
              el('td', { text: c.source })
            );
          }))
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · watchlist' : ' · early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ', ' + row.category_multiple_source + ')' }), el('b', { class: 'num', text: Number(row.category_multiple).toFixed(4) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Size multiplier' }), el('b', { class: 'num', text: Number(row.size_multiplier).toFixed(4) })),
        el('div', null, el('span', { text: 'Calibration multiplier' }), el('b', { class: 'num', text: Number(row.calibration_multiplier).toFixed(4) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: Number(row.growth_multiplier).toFixed(4) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: Number(row.maturity_multiplier).toFixed(4) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { class: 'num', text: Number(row.breadth_multiplier).toFixed(4) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(modelStrip());
    if (state.tab === 'pre-token') shell.appendChild(spotlight());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
