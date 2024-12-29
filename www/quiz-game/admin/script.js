let _game = {};

window.onload = function () {
	_game.htmlState = document.getElementById('state');
	_game.htmlNextText = document.getElementById('nextText');
	_game.htmlNextInteract = document.getElementById('nextInteract');
	_game.htmlInitial = document.getElementById('initial');
	_game.htmlWarning = document.getElementById('warning');
	_game.htmlWarningText = document.getElementById('warningText');
	_game.htmlLogin = document.getElementById('login');
	_game.htmlList = document.getElementById('options');

	/* fetch all options */
	_game.options = [];
	_game.htmlOptions = [];
	fetch('/quiz-game/admin/questions.json')
		.then((resp) => resp.json())
		.then(function (resp) {
			_game.options = resp;

			/* setup the body */
			for (let i = 0; i < _game.options.length; ++i) {
				/* add the next separator */
				if (i > 0) {
					let sep = document.createElement('div');
					sep.classList.add('separator');
					_game.htmlList.appendChild(sep);
				}
				let obj = {};

				/* add the next option */
				obj.option = document.createElement('div');
				obj.option.classList.add('option');
				obj.interact = document.createElement('div');
				obj.option.appendChild(obj.interact);
				obj.interact.classList.add('interact');
				obj.text = document.createElement('p');
				obj.text.innerText = _game.options[i].desc;
				obj.interact.appendChild(obj.text);
				obj.interact.onclick = () => _game.select(i);
				_game.htmlOptions.push(obj);
				_game.htmlList.appendChild(obj.option);

				for (let j = 0; j < _game.options[i].text.length; ++j) {
					let child = document.createElement('p');
					child.classList.add('text');
					obj.interact.appendChild(child);

					child.innerText = _game.options[i].text[j];
				}
			}
		});

	/* setup the overall state */
	_game.state = {};
	_game.active = false;
	_game.current = -1;

	/* setup the web-socket */
	let url = new URL(document.URL);
	let protocol = (url.protocol.startsWith('https') ? 'wss' : 'ws');
	_game.sock = {
		ws: null,
		url: `${protocol}://${url.host}/quiz-game/ws-admin`,
		queue: [],
		handling: false,
		state: 'creating',
		connectionFailedDelay: 256
	};
	_game.setupConnection();
};
window.onbeforeunload = function () { return "Your work will be lost."; };

_game.connectionFailed = function () {
	if (_game.sock.connectionFailedDelay > 8192) {
		console.log('Not trying a new connection');
		_game.sock.state = 'failed';
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
		try {
			/* parse the message and handle it accordingly */
			let msg = JSON.parse(m.data);
			switch (msg.code) {
				case 'loggedOff':
					_game.handleLogOff();
					_game.restartConnection();
					break;
				case 'dirty':
					_game.handleChange();
					break;
				default:
					if (_game.sock.queue.length == 0) {
						console.log(`Unsolicited message from server: [${msg.code}]`);
						return;
					}
					let next = _game.sock.queue.shift();
					next[1](msg);
					_game.sock.handling = false;

					/* queue the next task to be handled */
					_game.handleTask();
					break;
			}
		} catch (e) {
			console.log(`Error while handling message: ${e}`);
			_game.restartConnection();
		}
	};
	_game.sock.ws.onclose = function () {
		console.log('Connection to remote side lost');
		_game.restartConnection();
	};
	_game.sock.ws.onopen = function () {
		console.log('Connection established');
		_game.sock.state = 'ready';
		_game.sock.connectionFailedDelay = 256;
		if (_game.active)
			_game.login();
	};
	_game.sock.ws.onerror = function () {
		console.log('Failed to establish a connection to the server');
		_game.connectionFailed();
	};
};
_game.restartConnection = function () {
	if (_game.sock.state == 'creating' || _game.sock.state == 'restart')
		return;
	_game.sock.ws.close();
	_game.sock.ws = null;
	_game.sock.state = 'restart';
	setTimeout(() => _game.setupConnection(), 150);
};
_game.handleLogOff = function () {
	/* setup the warning screen */
	_game.htmlInitial.classList.remove('hidden');
	_game.htmlWarning.classList.remove('hidden');
	_game.htmlWarningText.innerText = 'Another Admin has become Acting Admin, you have been logged off!';
	_game.htmlLogin.classList.remove('hidden');
	_game.active = false;
};
_game.handleChange = function () {
	/* queue the task to fetch the score */
	_game.pushTask({ cmd: 'state' }, (resp) => {
		if (resp.code != 'ok') {
			console.log(`Failed to fetch the current state: ${resp.code}`);
			setTimeout(() => _game.handleChange(), 1500);
			return;
		}
		_game.state = resp;
		_game.applyState();
	});
};
_game.applyState = function () {
	console.log('Applying received state');

	/* update the options */
	let selectOption = (_game.state.state == 'start' || _game.state.state == 'resolved');
	for (let i = 0; i < _game.options.length; ++i) {
		if (_game.options[i].desc == _game.state.current) {
			_game.htmlOptions[i].option.classList.add('active');
			_game.current = i;
		}
		else
			_game.htmlOptions[i].option.classList.remove('active');
		if (selectOption)
			_game.htmlOptions[i].interact.classList.remove('disabled');
		else
			_game.htmlOptions[i].interact.classList.add('disabled');
	}

	/* update the state */
	switch (_game.state.state) {
		case 'start':
			_game.htmlState.innerText = 'State: Initial State';
			_game.htmlNextText.innerText = 'Select the Next Round...';
			_game.htmlNextInteract.classList.add('disabled');
			break;
		case 'open':
			_game.htmlState.innerText = 'State: Selection Enabled';
			_game.htmlNextText.innerText = 'Close Round...';
			_game.htmlNextInteract.classList.remove('disabled');
			break;
		case 'closed':
			_game.htmlState.innerText = 'State: Round Closed';
			_game.htmlNextText.innerText = 'Present Solution...';
			_game.htmlNextInteract.classList.remove('disabled');
			break;
		case 'resolved':
			_game.htmlState.innerText = 'State: Solution Presented';
			_game.htmlNextText.innerText = 'Select the Next Round...';
			_game.htmlNextInteract.classList.add('disabled');
			break;
		default:
			_game.htmlState.innerText = 'State: Unknown State';
			break;
	}
};
_game.handleTask = function () {
	if (_game.sock.queue.length == 0 || _game.sock.handling)
		return;
	if (_game.sock.state != 'ready')
		return;
	console.log(`Sending task: ${_game.sock.queue[0][0].cmd}`)
	_game.sock.handling = true;
	_game.sock.ws.send(JSON.stringify(_game.sock.queue[0][0]));
}
_game.pushTask = function (cmd, callback) {
	_game.sock.queue.push([cmd, callback]);
	_game.handleTask();
}
_game.login = function (reset, resetAll) {
	console.log('logging in...');

	/* check if an existing connection is being restarted */
	if (_game.active) {
		/* check if the first command is already a login command */
		if (_game.sock.queue.length > 0 && _game.sock.queue[0][0].cmd == 'login')
			return;
	}

	/* check if the state is ready */
	if (_game.sock.state != 'ready') {
		_game.htmlInitial.classList.remove('hidden');
		_game.htmlWarning.classList.remove('hidden');
		if (_game.sock.state == 'failed') {
			_game.htmlLogin.classList.add('hidden');
			_game.htmlWarningText.innerText = 'Unable to establish a connection to the server!';
		}
		else {
			_game.htmlLogin.classList.remove('hidden');
			_game.htmlWarningText.innerText = 'Connection to server is being established...';
		}
		return;
	}

	/* queue the login-task */
	_game.pushTask({ cmd: 'login' }, (resp) => {
		if (resp.code == 'ok') {
			console.log('Logged in successfully');

			/* toggle to the main screen */
			_game.htmlInitial.classList.add('hidden');
			_game.active = true;
			_game.handleChange();

			/* check if the round should be reset */
			if (reset) {
				_game.pushTask({ cmd: 'reset', total: resetAll }, (resp) => {
					if (resp.code != 'ok')
						console.log(`Reset failed: ${resp.code}`);
				});
			}
			return;
		}
		console.log(`Login failed: ${resp.code}`);

		/* setup the warning screen */
		_game.htmlInitial.classList.remove('hidden');
		_game.htmlWarning.classList.remove('hidden');

		/* kill the last login */
		if (_game.active) {
			_game.htmlWarningText.innerText = 'You have been logged off due to an error with the connection!';
			_game.htmlLogin.classList.remove('hidden');
			_game.active = false;
		}
		else {
			console.log(`Unknown response code: ${resp.code} received`);
			_game.htmlWarningText.innerText = 'An unknown error occurred!';
			_game.htmlLogin.classList.add('hidden');
		}
	});
};
_game.next = function () {
	console.log('Going to next state');

	/* update the state */
	switch (_game.state.state) {
		case 'open':
			_game.pushTask({ cmd: 'close' }, (resp) => {
				if (resp.code != 'ok')
					console.log(`Failed to advance the state: ${resp.code}`);
			});
			break;
		case 'closed':
			let value = _game.options[_game.current].correct;
			_game.pushTask({ cmd: 'resolve', value: value }, (resp) => {
				if (resp.code != 'ok')
					console.log(`Failed to advance the state: ${resp.code}`);
			});
			break;
		default:
			console.log(`State cannot be advanced: ${_game.state.state}`);
			break;
	}
};
_game.select = function (index) {
	console.log(`Starting round: ${index}`);
	_game.current = index;

	/* setup the request */
	let cmd = { cmd: 'next', description: _game.options[_game.current].desc, options: _game.options[_game.current].text };
	_game.pushTask(cmd, (resp) => {
		if (resp.code != 'ok')
			console.log(`Failed to select next round: ${resp.code}`);
	});
};