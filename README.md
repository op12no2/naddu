# Naddu

Naddu is a Javascript UCI chess engine.

It can be easily included in your web pages.

```
const naddu = new Worker('naddu.js');
const ucioutput = document.getElementById('ucioutput');

naddu.onmessage = function(e) {
  ucioutput.textContent += e.data + '\n'; // naddu reponds with text as per UCI 
};

naddu.postMessage('uci');
naddu.postMessage('ucinewgame');
naddu.postMessage('position startpos');
naddu.postMessage('board');
naddu.postMessage('eval');
naddu.postMessage('go depth 8');
naddu.postMessage('go movetime 1000')
```

Try the example code: https://op12no2.github.io/naddu/naddu.html
