const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());

const ticTacToeRooms = {};
const drawGuessRooms = {};

// Tic-Tac-Toe Logic
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Tic-Tac-Toe: Join Room
  socket.on('joinTicTacToe', (roomId) => {
    if (!ticTacToeRooms[roomId]) {
      ticTacToeRooms[roomId] = {
        players: [],
        board: Array(9).fill(null),
        currentPlayer: 'X',
        status: 'waiting',
        scores: { X: 0, O: 0 },
      };
    }

    if (ticTacToeRooms[roomId].players.length < 2) {
      ticTacToeRooms[roomId].players.push(socket.id);
      socket.join(roomId);
      socket.emit('playerAssignment', ticTacToeRooms[roomId].players.length === 1 ? 'X' : 'O');

      if (ticTacToeRooms[roomId].players.length === 2) {
        ticTacToeRooms[roomId].status = 'playing';
        io.to(roomId).emit('gameState', ticTacToeRooms[roomId]); // Emit to all in room immediately
      } else {
        socket.emit('gameState', ticTacToeRooms[roomId]); // Emit current state to new player
      }
    } else {
      socket.emit('roomFull');
    }
  });

  // Tic-Tac-Toe: Handle Move
  socket.on('makeMove', ({ roomId, index }) => {
    const room = ticTacToeRooms[roomId];
    if (room && room.status === 'playing' && room.board[index] === null) {
      const player = room.players[0] === socket.id ? 'X' : 'O';
      if (player === room.currentPlayer) {
        room.board[index] = player;
        room.currentPlayer = room.currentPlayer === 'X' ? 'O' : 'X';

        // Check for winner
        const winner = checkTicTacToeWinner(room.board);
        if (winner) {
          room.status = 'finished';
          room.scores[winner] = (room.scores[winner] || 0) + 1;
          io.to(roomId).emit('gameState', { ...room, winner });
        } else if (!room.board.includes(null)) {
          room.status = 'finished';
          io.to(roomId).emit('gameState', { ...room, winner: 'draw' });
        } else {
          io.to(roomId).emit('gameState', room);
        }
      }
    }
  });

  // Tic-Tac-Toe: Handle Restart
  socket.on('restartTicTacToe', (roomId) => {
    const room = ticTacToeRooms[roomId];
    if (room && room.players.includes(socket.id)) {
      room.board = Array(9).fill(null);
      room.currentPlayer = 'X';
      room.status = 'playing';
      io.to(roomId).emit('gameState', room);
    }
  });

  // Drawing & Guessing: Join Room
  socket.on('joinDrawGuess', (roomId) => {
    if (!drawGuessRooms[roomId]) {
      drawGuessRooms[roomId] = {
        players: [],
        currentDrawer: null,
        word: null,
        guesses: [],
        status: 'waiting',
      };
    }

    if (drawGuessRooms[roomId].players.length < 10) {
      drawGuessRooms[roomId].players.push(socket.id);
      socket.join(roomId);
      if (drawGuessRooms[roomId].players.length >= 3 && !drawGuessRooms[roomId].currentDrawer) {
        startNewDrawGuessRound(roomId);
      }
      io.to(roomId).emit('gameState', drawGuessRooms[roomId]);
    } else {
      socket.emit('roomFull');
    }
  });

  // Drawing & Guessing: Handle Drawing
  socket.on('draw', ({ roomId, data }) => {
    if (drawGuessRooms[roomId]?.currentDrawer === socket.id) {
      io.to(roomId).emit('draw', data);
    }
  });

  // Drawing & Guessing: Handle Guess
  socket.on('guess', ({ roomId, guess }) => {
    const room = drawGuessRooms[roomId];
    if (room && socket.id !== room.currentDrawer) {
      room.guesses.push({ player: socket.id, guess });
      if (guess.toLowerCase() === room.word?.toLowerCase()) {
        io.to(roomId).emit('correctGuess', socket.id);
        startNewDrawGuessRound(roomId);
      } else {
        io.to(roomId).emit('gameState', room);
      }
    }
  });

  // Handle Disconnect
  socket.on('disconnect', () => {
    for (const roomId in ticTacToeRooms) {
      const room = ticTacToeRooms[roomId];
      room.players = room.players.filter((id) => id !== socket.id);
      if (room.players.length < 2) {
        room.status = 'waiting';
        io.to(roomId).emit('gameState', room);
      }
    }
    for (const roomId in drawGuessRooms) {
      const room = drawGuessRooms[roomId];
      room.players = room.players.filter((id) => id !== socket.id);
      if (room.currentDrawer === socket.id) {
        startNewDrawGuessRound(roomId);
      }
      io.to(roomId).emit('gameState', room);
    }
  });
});

// Helper: Check Tic-Tac-Toe Winner
function checkTicTacToeWinner(board) {
  const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
    [0, 4, 8], [2, 4, 6], // Diagonals
  ];
  for (const pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
}

// Helper: Start New Drawing Round
function startNewDrawGuessRound(roomId) {
  const room = drawGuessRooms[roomId];
  if (room.players.length >= 3) {
    room.currentDrawer = room.players[Math.floor(Math.random() * room.players.length)];
    room.word = getRandomWord();
    room.guesses = [];
    room.status = 'playing';
    io.to(roomId).emit('gameState', room);
  } else {
    room.status = 'waiting';
    room.currentDrawer = null;
    room.word = null;
    io.to(roomId).emit('gameState', room);
  }
}

// Helper: Get Random Word for Drawing
function getRandomWord() {
  const words = ['apple', 'house', 'tree', 'car', 'dog', 'sun', 'book'];
  return words[Math.floor(Math.random() * words.length)];
}

server.listen(4000, () => {
  console.log('Server running on http://localhost:4000');
});