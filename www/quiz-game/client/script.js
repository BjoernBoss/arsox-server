/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024 Bjoern Boss Henrichsen */
let _game = {};

window.onload = function () {
	/* setup the overall state */
	_game.state = {};
	_game.sessionId = new URLSearchParams(location.search).get('id') ?? 'no-session-id';
	_game.name = '';
	_game.self = null;
	_game.selectDescription = '';
	_game.selectCallback = null;
	_game.viewScore = false;
	_game.totalPlayerCount = 0;
	_game.effect = {
		expose: {
			timeout: 2,
			description: 'Exposed',
		},
		protect: {
			timeout: 4,
			description: 'Protected',
		},
		min: {
			timeout: 3,
			select: 'Select opponent to set the confidence to -1 to',
			description: 'Minimize',
		},
		max: {
			timeout: 3,
			select: 'Select opponent to set the confidence to 3 to',
			description: 'Maximize',
		},
		zero: {
			timeout: 4,
			select: 'Select opponent to not get any points',
			description: 'No Points',
		},
		steal: {
			timeout: 5,
			select: 'Select opponent to steal the points from',
			description: 'Steal',
		},
		fail: {
			timeout: 5,
			select: 'Select opponent to fail',
			description: 'Fail',
		},
		swap: {
			timeout: 10,
			select: 'Select opponent to swap points with',
			description: 'Swap Points',
		},
		double: {
			timeout: 8,
			description: 'Double or Nothing',
		},

	};
	_game.empty = {
		score: 0,
		ready: false,
		confidence: 1,
		choice: -1,
		correct: false,
		delta: 0,
		effect: {},
		last: {},
		applied: {},
	};

	/* setup the effect parameter */
	for (const key in _game.effect) {
		_game.effect[key].html = document.getElementById(key);
		_game.empty.effect[key] = null;
		_game.empty.applied[key] = null;
		_game.empty.last[key] = -1;
	}

	/* login-screen html components */
	_game.htmlLogin = document.getElementById('login');
	_game.htmlName = document.getElementById('name');
	_game.htmlWarning = document.getElementById('warning');
	_game.htmlWarningText = document.getElementById('warning-text');

	/* caption/footer components */
	_game.htmlMain = document.getElementById('main');
	_game.htmlSelfName = document.getElementById('self-name');
	_game.htmlCategory = document.getElementById('category');
	_game.htmlQuestion = document.getElementById('question');
	_game.htmlScore = document.getElementById('score');
	_game.htmlRound = document.getElementById('round');
	_game.htmlReady = document.getElementById('ready');
	_game.htmlConfidence = document.getElementById('confidence');
	_game.htmlDelta = document.getElementById('delta');

	/* splash-screen components */
	_game.htmlSplashScreen = document.getElementById('splash-screen');
	_game.htmlSplashMessage = document.getElementById('splash-message');

	/* gameplay components */
	_game.htmlGameScreen = document.getElementById('game-screen');
	_game.htmlGameLock = document.getElementById('game-lock');
	_game.htmlGameContent = document.getElementById('game-content');

	/* select components */
	_game.htmlSelectScreen = document.getElementById('select-screen');
	_game.htmlSelectText = document.getElementById('select-text');
	_game.htmlSelectContent = document.getElementById('select-content');

	/* setup components */
	_game.htmlSetupScreen = document.getElementById('setup-screen');
	_game.htmlSetupLock = document.getElementById('setup-lock');
	_game.htmlConfidenceSelect = document.getElementById('confidence-select');
	_game.htmlConfidenceValue = document.getElementById('confidence-value');
	_game.htmlConfidenceSlider = document.getElementById('confidence-slider');

	/* score components */
	_game.htmlScoreScreen = document.getElementById('score-screen');
	_game.htmlScoreContent = document.getElementById('score-content');
	_game.htmlToggleBoard = document.getElementById('toggle-board');

	/* setup the web-socket */
	let url = new URL(document.URL);
	let protocol = (url.protocol.startsWith('https') ? 'wss' : 'ws');
	_game.sock = {
		ws: null,
		url: `${protocol}://${url.host}/quiz-game/ws/${_game.sessionId}`,
		queue: [],
		dirty: false,
		state: 'creating', //creating, ready, busy, failed, error, restart
		connectionFailedDelay: 256
	};
	_game.setupConnection();
};

_game.connectionFailed = function () {
	if (_game.sock.connectionFailedDelay > 2048) {
		console.log('Not trying a new connection');
		_game.sock.state = 'failed';
		_game.failed('Unable to establish a connection to the server!');
	}
	else {
		_game.sock.state = 'error';
		setTimeout(() => _game.restartConnection(), _game.sock.connectionFailedDelay);
		_game.sock.connectionFailedDelay *= 2;
	}
};
_game.setupConnection = function () {
	console.log('Setting up connection');
	_game.sock.state = 'creating';
	try {
		_game.sock.ws = new WebSocket(_game.sock.url);
	} catch (e) {
		console.log(`Error while setting up connection: ${e}`);
		_game.connectionFailed();
	}

	_game.sock.ws.onmessage = function (m) {
		_game.handleMessage(m);
	};
	_game.sock.ws.onclose = function () {
		console.log('Connection to remote side lost');
		_game.restartConnection();
	};
	_game.sock.ws.onopen = function () {
		console.log('Connection established');
		_game.sock.state = 'ready';
		_game.sock.connectionFailedDelay = 256;
		_game.syncState(false, true);
	};
	_game.sock.ws.onerror = function () {
		console.log('Failed to establish a connection to the server');
		_game.sock.ws.onclose = function () { };
		_game.connectionFailed();
	};
};
_game.restartConnection = function () {
	if (_game.sock.state == 'creating' || _game.sock.state == 'restart' || _game.sock.state == 'failed')
		return;
	_game.sock.ws.close();
	_game.sock.ws = null;
	_game.sock.state = 'restart';
	setTimeout(() => _game.setupConnection(), 150);
};
_game.handleMessage = function (m) {
	_game.sock.state = 'ready';

	try {
		/* parse the message and handle it accordingly */
		let msg = JSON.parse(m.data);
		switch (msg.cmd) {
			case 'ok':
				break;
			case 'unknown-session':
				_game.failed('Unknown session!');
				_game.sock.state = 'failed';
				return;
			case 'state':
				_game.state = msg;
				_game.applyState();
				break;
			default:
				console.log(`Unexpected message: ${msg.cmd}`);
				_game.failed('An unknown error occurred!');
				break;
		}

		/* check if the next message should be sent */
		_game.syncState(true, false);
	} catch (e) {
		console.log(`Error while handling message: ${e}`);
		_game.restartConnection();
	}
};
_game.selfChanged = function () {
	_game.applyState();
	_game.syncState(false, false);
}
_game.syncState = function (checking, fetchOnly) {
	if (!checking)
		_game.sock.dirty = true;
	else if (!_game.sock.dirty)
		return;

	/* check if the socket is ready to send data */
	if (_game.sock.state != 'ready')
		return;
	_game.sock.state = 'busy';
	_game.sock.dirty = false;

	/* check if the data only need to be fetched */
	if (_game.self == null || fetchOnly) {
		console.log('fetching state...');
		_game.sock.ws.send(JSON.stringify({ cmd: 'state' }));
	}

	/* upload the current player-state */
	else {
		console.log('synchronizing state...');
		_game.sock.ws.send(JSON.stringify({
			cmd: 'update',
			name: _game.name,
			value: _game.self
		}));
	}
};
_game.applyState = function () {
	if (_game.name == '')
		return;
	console.log('Applying received state');

	/* fetch the total playercount */
	_game.totalPlayerCount = 0;
	for (const _ in _game.state.players)
		++_game.totalPlayerCount;

	/* check if the player has started to play or has been reset or update the state */
	if (_game.name in _game.state.players)
		_game.self = _game.state.players[_game.name];
	else if (_game.self == null) {
		_game.self = { ..._game.empty };
		_game.syncState(false, false);
	}
	else {
		_game.failed('Player has been reset');
		return;
	}

	/* construct the header and footer */
	_game.applyHeaderAndFooter();

	/* check if the scoreboard is currently being viewed */
	if (_game.viewScore) {
		_game.applyScore();
		return;
	}
	_game.htmlToggleBoard.innerText = 'Board';
	_game.htmlReady.classList.remove('hidden');

	/* check if a player is to be selected for an operation */
	if (_game.self.ready || _game.state.phase != 'category')
		_game.selectDescription = '';
	else if (_game.selectDescription.length > 0) {
		_game.applySelection();
		return;
	}

	/* check if the splash-screen needs to be shown */
	if (_game.state.question == null)
		_game.applySplashScreen();

	/* check if the question-screen needs to be constructed */
	else if (_game.state.phase == 'answer' || _game.state.phase == 'resolved')
		_game.applyQuestion();

	/* setup the category/effect setup screen */
	else
		_game.applySetup();
};
_game.canEffect = function (name, full) {
	if (full && (_game.self == null || _game.self.ready || _game.state.phase != 'Category'))
		return false;
	if ((_game.state.round - _game.self.last[name]) <= _game.effect[name].timeout)
		return false;
	if (_game.self.effect[name] != null)
		return false;
	return true;
};
_game.doEffect = function (name, value) {
	_game.self.last[name] = _game.state.round;
	_game.self.effect[name] = value;
	_game.selfChanged();
};

/* applying-state functions */
_game.applyHeaderAndFooter = function () {
	/* update the current score and category */
	_game.htmlSelfName.innerText = `Name: ${_game.name}`;
	_game.htmlScore.innerText = `Score: ${_game.self.score}`;
	if (_game.state.round == null)
		_game.htmlRound.innerText = `Round: None / ${_game.state.totalQuestions}`;
	else
		_game.htmlRound.innerText = `Round: ${_game.state.round + 1} / ${_game.state.totalQuestions}`;
	_game.htmlConfidence.innerText = `Confidence: ${_game.self.confidence}`;
	if (_game.state.question == null) {
		_game.htmlCategory.classList.add('hidden');
		_game.htmlQuestion.classList.add('hidden');
	}
	else {
		_game.htmlCategory.classList.remove('hidden');
		_game.htmlCategory.innerText = `Category: ${_game.state.question.category}`;

		if (_game.state.phase != 'category' || _game.self.effect.exposed) {
			_game.htmlQuestion.classList.remove('hidden');
			_game.htmlQuestion.innerText = _game.state.question.text;
		}
		else
			_game.htmlQuestion.classList.add('hidden');
	}

	/* update the points-delta */
	if (_game.state.phase == 'resolved') {
		_game.htmlDelta.classList.remove('hidden');
		if (_game.self.delta < 0)
			_game.htmlDelta.innerText = `Points: ${_game.self.delta}`;
		else
			_game.htmlDelta.innerText = `Points: +${_game.self.delta}`;
	}
	else
		_game.htmlDelta.classList.add('hidden');

	/* update the ready-state of the ready-button */
	if (_game.self.ready || _game.state.phase == 'done' || _game.totalPlayerCount < 2)
		_game.htmlReady.classList.add('disabled');
	else
		_game.htmlReady.classList.remove('disabled');

	/* count the number of ready players */
	let readyCount = 0;
	for (const key in _game.state.players) {
		if (_game.state.players[key].ready)
			++readyCount;
	}
	_game.htmlReady.children[0].children[0].innerText = `Ready (${readyCount} / ${_game.totalPlayerCount})`;
};
_game.applyScore = function () {
	_game.screen('score');
	_game.htmlToggleBoard.innerText = 'Return to Game';
	_game.htmlReady.classList.add('hidden');

	/* collect the list of all players and sort them by their score */
	let list = [];
	for (const key in _game.state.players)
		list.push([key, _game.state.players[key].score]);
	list.sort((a, b) => ((a[1] < b[1] || (a[1] == b[1] && a[0] > b[0])) ? 1 : -1));

	/* add the list of players */
	for (let i = 0; i < list.length; ++i) {
		/* check if the element already exists or needs to be created */
		if (i >= _game.htmlScoreContent.children.length) {
			let node = document.createElement('div');
			_game.htmlScoreContent.appendChild(node);
			node.classList.add('score');
		}
		let node = _game.htmlScoreContent.children[i];
		let player = _game.state.players[list[i][0]];
		let count = 0;
		let makeNext = function () {
			if (count >= node.children.length) {
				let temp = document.createElement('p');
				node.appendChild(temp);
				temp.classList.add(count == 0 ? 'name' : 'detail');
			}
			return node.children[count++];
		};

		/* add the name and score and ready-flag (first has always name-style) */
		makeNext().innerText = `Name: ${list[i][0]}`;
		makeNext().innerText = `Score: ${player.score}`;
		makeNext().innerText = `Ready: ${player.ready ? 'True' : 'False'}`;

		/* add the result */
		if (_game.state.phase == 'resolved') {
			let next = makeNext();
			if (_game.choice == -1)
				next.innerText = `Result: None`;
			else
				next.innerText = `Result: ${_game.state.question.options[player.choice]} (${player.correct ? 'Correct' : 'Incorrect'})`;
		}

		/* add the confidence */
		if (_game.state.phase == 'resolved')
			makeNext().innerText = `Confidence: ${player.confidence}`;

		/* add the delta */
		if (_game.state.phase == 'resolved')
			makeNext().innerText = `Points: ${player.delta < 0 ? '' : '+'}${player.delta}`;

		/* add the effects flags */
		for (const key in player.effect) {
			if (player.applied[key] == null)
				continue;
			makeNext().innerText = `${_game.effect[key].description}: ${player.applied[key]}`;
		}

		/* remove any remaining children */
		while (node.children.length > count)
			node.lastChild.remove();
	}

	/* remove the remaining children */
	while (_game.htmlScoreContent.children.length > list.length)
		_game.htmlScoreContent.lastChild.remove();
};
_game.applySelection = function () {
	_game.screen('select');
	_game.htmlSelectText.innerText = _game.selectDescription;

	/* collect the list of all players and sort them by their score */
	let list = [];
	for (const key in _game.state.players) {
		if (key != _game.name)
			list.push([key, _game.state.players[key].score]);
	}
	list.sort((a, b) => ((a[1] < b[1] || (a[1] == b[1] && a[0] > b[0])) ? 1 : -1));

	/* add the list of players */
	for (let i = 0; i < list.length; ++i) {
		/* check if the element already exists or needs to be created ([0/1] is text/cancel) */
		if (2 + i >= _game.htmlSelectContent.children.length) {
			let node = document.createElement('div');
			_game.htmlSelectContent.appendChild(node);
			node.classList.add('button');
			let inner = document.createElement('div');
			node.appendChild(inner);
			inner.classList.add('clickable');
			inner.appendChild(document.createElement('p'));
			let sub = document.createElement('p');
			inner.appendChild(sub);
			sub.classList.add('sub');
		}
		let node = _game.htmlSelectContent.children[i + 2];

		/* add the name and score and callback */
		node.children[0].children[0].innerText = list[i][0];
		node.children[0].children[1].innerText = `Score: ${list[i][1]}`;
		node.children[0].onclick = () => _game.pick(list[i][0]);
	}

	/* remove the remaining children */
	while (_game.htmlSelectContent.children.length > 2 + list.length)
		_game.htmlSelectContent.lastChild.remove();
};
_game.applySplashScreen = function () {
	_game.screen('splash');
	if (_game.state.phase == 'start')
		_game.htmlSplashMessage.innerText = 'Ready up to start playing!';
	else
		_game.htmlSplashMessage.innerText = 'Game Over!';
};
_game.applyQuestion = function () {
	_game.screen('game');

	/* update the ready-visibility */
	if (_game.self.ready)
		_game.htmlGameLock.classList.remove('hidden');
	else
		_game.htmlGameLock.classList.add('hidden');

	/* add the options based on the selection and result */
	for (let i = 0; i < _game.state.question.options.length; ++i) {
		/* check if the element already exists or needs to be created ([0] is lock-overlay) */
		if (1 + i >= _game.htmlGameContent.children.length) {
			let node = document.createElement('div');
			_game.htmlGameContent.appendChild(node);
			node.classList.add('button');
			let inner = document.createElement('div');
			node.appendChild(inner);
			inner.classList.add('clickable');
			inner.onclick = () => _game.choose(i);
			inner.appendChild(document.createElement('p'));
		}
		let node = _game.htmlGameContent.children[i + 1];

		/* setup the selection-index */
		if (_game.self.choice == i)
			node.classList.add('selected');
		else
			node.classList.remove('selected');

		/* setup the disabled-index */
		if (_game.state.phase == 'resolved')
			node.classList.add('disabled');
		else
			node.classList.remove('disabled');

		/* setup the result colors */
		if (_game.state.phase == 'answer') {
			node.classList.remove('invalid');
			node.classList.remove('correct');
		}
		else if (_game.state.question.correct == i) {
			node.classList.remove('invalid');
			node.classList.add('correct');
		}
		else {
			node.classList.remove('correct');
			node.classList.add('invalid');
		}

		/* add the actual text content */
		node.children[0].children[0].innerText = _game.state.question.options[i];
	}

	/* remove the remaining children */
	while (_game.htmlGameContent.children.length > 1 + _game.state.question.options.length)
		_game.htmlGameContent.lastChild.remove();
};
_game.applySetup = function () {
	_game.screen('setup');

	/* update the setup ready-screen */
	if (_game.self.ready)
		_game.htmlSetupLock.classList.remove('hidden');
	else
		_game.htmlSetupLock.classList.add('hidden');

	/* update the confidence slider */
	_game.htmlConfidenceValue.innerText = `Confidence: ${_game.self.confidence}`;
	for (let i = 0; i < 5; ++i)
		_game.htmlConfidenceSelect.classList.remove(`value${i}`);
	_game.htmlConfidenceSelect.classList.add(`value${_game.self.confidence + 1}`);
	_game.htmlConfidenceSlider.value = _game.self.confidence;

	/* update the effect buttons */
	for (const key in _game.effect)
		_game._applyEffect(key);
};
_game._applyEffect = function (name) {
	let can = _game.canEffect(name, false);
	let html = _game.effect[name].html;

	if (can)
		html.classList.remove('disabled');
	else
		html.classList.add('disabled');

	if (_game.self.effect[name] != null && ('select' in _game.effect[name]))
		html.children[0].children[2].innerText = `Selected: ${_game.self.effect[name]}`;
	else if (can)
		html.children[0].children[2].innerText = `Timed Out for ${_game.effect[name].timeout} Rounds`;
	else
		html.children[0].children[2].innerText = `Available in ${_game.self.last[name] + _game.effect[name].timeout - _game.state.round + 1} Rounds`;
};

/* called from/for html */
_game.screen = function (name) {
	_game.htmlLogin.classList.add('hidden');
	_game.htmlMain.classList.add('hidden');
	_game.htmlSplashScreen.classList.add('hidden');
	_game.htmlSetupScreen.classList.add('hidden');
	_game.htmlGameScreen.classList.add('hidden');
	_game.htmlSelectScreen.classList.add('hidden');
	_game.htmlScoreScreen.classList.add('hidden');

	if (name == 'login')
		_game.htmlLogin.classList.remove('hidden');
	else {
		_game.htmlMain.classList.remove('hidden');
		if (name == 'splash')
			_game.htmlSplashScreen.classList.remove('hidden');
		else if (name == 'setup')
			_game.htmlSetupScreen.classList.remove('hidden');
		else if (name == 'game')
			_game.htmlGameScreen.classList.remove('hidden');
		else if (name == 'select')
			_game.htmlSelectScreen.classList.remove('hidden');
		else if (name == 'score')
			_game.htmlScoreScreen.classList.remove('hidden');
	}
}
_game.failed = function (msg) {
	_game.screen('login');
	_game.htmlWarning.classList.remove('hidden');
	_game.htmlWarningText.innerText = msg;
	_game.self = null;
	_game.selectDescription = '';
	_game.viewScore = false;
	_game.name = '';
};
_game.login = function () {
	/* validate the name */
	if (_game.htmlName.value == '') {
		_game.failed('Please Enter a Name');
		return;
	}

	/* check if the server connection exists */
	if (_game.sock.state != 'ready' && _game.sock.state != 'busy') {
		if (_game.sock.state == 'failed') {
			_game.failed('Retrying to connect to server. Try again later...');
			_game.sock.connectionFailedDelay = 256;
			_game.setupConnection();
		}
		else
			_game.failed('Connecting to server. Try again later...');
		return;
	}

	/* extract the parameter and sync the game up */
	_game.name = _game.htmlName.value.trim();
	_game.syncState(false, true);
};
_game.ready = function () {
	if (_game.self == null || _game.self.ready || _game.state.phase == 'done' || _game.totalPlayerCount < 2)
		return;

	_game.self.ready = true;
	_game.selfChanged();
};
_game.toggleScore = function () {
	if (_game.self == null)
		return;
	_game.viewScore = !_game.viewScore;
	_game.applyState();
};
_game.slide = function (v) {
	if (_game.self == null || _game.self.ready || _game.state.phase != 'category')
		return;

	_game.self.confidence = Number(v);
	_game.selfChanged();
};
_game.choose = function (v) {
	if (_game.self == null || _game.self.ready || _game.state.phase != 'answer')
		return;

	_game.self.choice = v;
	_game.self.correct = (_game.self.choice == _game.state.question.correct);
	_game.selfChanged();
};
_game.activate = function (name) {
	if (!_game.canEffect(name, true))
		return;
	if (!('select' in _game.effect[name])) {
		_game.doEffect(name, _game.name);
		return;
	}

	_game.selectDescription = _game.effect[name].select;
	_game.selectCallback = function (v) {
		if (_game.canEffect(name, true))
			_game.doEffect(name, v);
	};
	_game.applyState();
};
_game.pick = function (v) {
	/* select-callback will automatically apply state */
	_game.selectDescription = '';
	_game.selectCallback(v);
};
_game.remove = function () {
	if (_game.sock.state != 'ready' && _game.sock.state != 'busy') {
		_game.failed('Network issue while removing player');
	}
	else {
		_game.sock.ws.send(JSON.stringify({ cmd: 'update', name: _game.name }));
		_game.state.players[_game.name] = undefined;
		_game.failed('Player has been removed');
	}
};
