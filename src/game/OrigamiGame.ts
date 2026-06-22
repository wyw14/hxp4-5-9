import { questionBank, modelDescriptions, type Question } from '../data/questionBank';
import { SeededRandom, generateSeed } from '../utils/random';
import { OrigamiSVG } from '../components/OrigamiSVG';
import { Model3DViewer } from '../components/Model3DViewer';
import { FoldStateManager } from './FoldStateManager';

export type TrainingMode = 'all' | 'single' | 'progressive';

export interface TrainingConfig {
  mode: TrainingMode;
  targetDifficulty: number | null;
  minDifficulty: number;
  maxDifficulty: number;
  currentDifficultyLevel: number;
}

export interface GameState {
  currentQuestion: Question | null;
  score: number;
  level: number;
  stepsUsed: number;
  selectedModelId: string | null;
  gameStatus: 'idle' | 'playing' | 'won' | 'lost' | 'selecting';
  trainingConfig: TrainingConfig;
}

export class OrigamiGame {
  private container: HTMLElement;
  private state: GameState;
  private seed: number;
  private rng: SeededRandom;
  private questionPool: Question[] = [];
  private currentQuestionIndex: number = 0;
  private origamiSVG: OrigamiSVG | null = null;
  private foldStateManager: FoldStateManager | null = null;
  private modelViewers: Model3DViewer[] = [];
  private shuffledOptions: string[] = [];

  private modelsContainer: HTMLElement | null = null;
  private submitBtn: HTMLButtonElement | null = null;
  private resetBtn: HTMLButtonElement | null = null;
  private hintBtn: HTMLButtonElement | null = null;
  private nextBtn: HTMLButtonElement | null = null;
  private trainingBtn: HTMLButtonElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.state = {
      currentQuestion: null,
      score: 0,
      level: 1,
      stepsUsed: 0,
      selectedModelId: null,
      gameStatus: 'selecting',
      trainingConfig: {
        mode: 'all',
        targetDifficulty: null,
        minDifficulty: 1,
        maxDifficulty: this.getMaxDifficulty(),
        currentDifficultyLevel: 1
      }
    };
    this.seed = generateSeed();
    this.rng = new SeededRandom(this.seed);

    this.showTrainingSelection();
  }

  private loadQuestion(index: number): void {
    let safeIndex = index;
    if (index >= this.questionPool.length) {
      if (this.state.trainingConfig.mode === 'progressive' &&
          this.state.trainingConfig.currentDifficultyLevel < this.state.trainingConfig.maxDifficulty) {
        this.state.trainingConfig.currentDifficultyLevel++;
        this.buildQuestionPool();
        safeIndex = 0;
        this.showMessage(`🎉 恭喜！升级到难度 ${this.state.trainingConfig.currentDifficultyLevel}！`, 'success');
      } else {
        this.currentQuestionIndex = 0;
        this.questionPool = this.rng.shuffle([...this.questionPool]);
        safeIndex = 0;
        this.showMessage('🔄 所有题目已完成，重新开始！', 'info');
      }
    }

    const question = this.questionPool[safeIndex];
    this.currentQuestionIndex = safeIndex;
    this.state.currentQuestion = question;
    this.state.stepsUsed = 0;
    this.state.selectedModelId = null;
    this.state.gameStatus = 'playing';

    this.updateUI();
    this.setupOrigamiSVG(question);
    this.setupFoldState(question);
    this.setupModelOptions(question);
    this.updateSubmitState();

    if (this.nextBtn) {
      this.nextBtn.style.display = 'none';
    }
  }

  private setupOrigamiSVG(question: Question): void {
    const svgContainer = this.container.querySelector('#svg-container') as HTMLElement;
    if (!svgContainer) return;

    if (this.origamiSVG) {
      this.origamiSVG.destroy();
    }

    this.origamiSVG = new OrigamiSVG(
      svgContainer,
      question,
      (lineId) => this.handleFold(lineId),
      (lineId) => this.handleUnfold(lineId)
    );
  }

  private setupFoldState(question: Question): void {
    this.foldStateManager = new FoldStateManager(question);
  }

  private setupModelOptions(question: Question): void {
    this.modelViewers.forEach(viewer => viewer.destroy());
    this.modelViewers = [];

    const options = [question.correctModelId, ...question.distractorModelIds];
    this.shuffledOptions = this.rng.shuffle(options);

    if (this.modelsContainer) {
      this.modelsContainer.innerHTML = '';
    }

    this.shuffledOptions.forEach((modelId) => {
      const modelCard = document.createElement('div');
      modelCard.className = 'model-card';
      modelCard.dataset.modelId = modelId;

      const modelViewerContainer = document.createElement('div');
      modelViewerContainer.className = 'model-viewer';
      modelCard.appendChild(modelViewerContainer);

      const modelLabel = document.createElement('div');
      modelLabel.className = 'model-label';
      const desc = modelDescriptions[modelId];
      modelLabel.textContent = desc ? desc.name : modelId;
      modelCard.appendChild(modelLabel);

      modelCard.addEventListener('click', () => this.selectModel(modelId));

      this.modelsContainer?.appendChild(modelCard);

      const viewer = new Model3DViewer(modelViewerContainer);
      viewer.loadModel(modelId);
      this.modelViewers.push(viewer);
    });
  }

  private handleFold(lineId: string): void {
    if (!this.foldStateManager || this.state.gameStatus !== 'playing') return;

    if (this.foldStateManager.fold(lineId)) {
      this.state.stepsUsed = this.foldStateManager.getCurrentStep();
      this.updateStepsDisplay();
      this.checkFoldComplete();
    } else {
      this.origamiSVG?.unfoldLine(lineId, false);
      const nextLine = this.foldStateManager.getNextFoldLine();
      if (nextLine) {
        this.showMessage(`请按顺序折叠：第 ${nextLine.order} 步 - ${this.formatFoldType(nextLine.type)}`, 'info');
      }
    }
    this.updateSubmitState();
  }

  private handleUnfold(lineId: string): void {
    if (!this.foldStateManager || this.state.gameStatus !== 'playing') return;

    if (this.foldStateManager.unfold(lineId)) {
      this.state.stepsUsed = this.foldStateManager.getCurrentStep();
      this.updateStepsDisplay();
    } else {
      this.origamiSVG?.foldLine(lineId, false);
      this.showMessage('只能撤销最后一步折痕，请先撤销后面的折痕。', 'info');
    }
    this.updateSubmitState();
  }

  private checkFoldComplete(): void {
    if (this.foldStateManager?.isComplete()) {
      this.showMessage('🎉 所有折叠完成！请选择正确的3D模型', 'info');
    }
    this.updateSubmitState();
  }

  private selectModel(modelId: string): void {
    if (this.state.gameStatus !== 'playing') return;

    this.state.selectedModelId = modelId;

    this.modelViewers.forEach(viewer => {
      viewer.setSelected(viewer.getModelId() === modelId);
    });

    this.container.querySelectorAll('.model-card').forEach(card => {
      const htmlCard = card as HTMLElement;
      htmlCard.classList.remove('selected');
      if (htmlCard.dataset.modelId === modelId) {
        htmlCard.classList.add('selected');
      }
    });

    this.updateSubmitState();

    if (!this.foldStateManager?.isComplete()) {
      this.showMessage('请先按顺序完成全部折叠，再提交答案。', 'info');
    }
  }

  private checkAnswer(): void {
    if (!this.state.currentQuestion || !this.state.selectedModelId) return;

    if (!this.foldStateManager?.isComplete()) {
      this.updateSubmitState();
      this.showMessage('还没有完成折叠，先按提示折完再提交答案。', 'info');
      return;
    }

    const isCorrect = this.state.selectedModelId === this.state.currentQuestion.correctModelId;

    if (isCorrect) {
      const stepsBonus = Math.max(0, this.state.currentQuestion.maxSteps - this.state.stepsUsed) * 10;
      const baseScore = this.state.currentQuestion.difficulty * 100;
      this.state.score += baseScore + stepsBonus;
      this.state.gameStatus = 'won';
      this.showMessage(`🎉 答对了！获得 ${baseScore + stepsBonus} 分`, 'success');
    } else {
      this.state.gameStatus = 'lost';
      this.showMessage('😅 答错了，再试试吧！正确答案已高亮', 'error');
      this.highlightCorrectAnswer();
    }

    this.updateScoreDisplay();

    if (this.nextBtn) {
      this.nextBtn.style.display = 'inline-block';
    }

    if (this.submitBtn) {
      this.submitBtn.disabled = true;
    }
  }

  private highlightCorrectAnswer(): void {
    if (!this.state.currentQuestion) return;

    const correctId = this.state.currentQuestion.correctModelId;
    this.container.querySelectorAll('.model-card').forEach(card => {
      const htmlCard = card as HTMLElement;
      if (htmlCard.dataset.modelId === correctId) {
        htmlCard.classList.add('correct');
      }
    });
  }

  private resetFolds(): void {
    this.origamiSVG?.reset();
    this.foldStateManager?.reset();
    this.state.stepsUsed = 0;
    this.state.gameStatus = 'playing';
    this.state.selectedModelId = null;

    this.modelViewers.forEach(viewer => viewer.setSelected(false));
    this.container.querySelectorAll('.model-card').forEach(card => {
      card.classList.remove('selected', 'correct');
    });

    this.updateSubmitState();
    if (this.nextBtn) {
      this.nextBtn.style.display = 'none';
    }

    this.hideMessage();
    this.updateStepsDisplay();
  }

  private showHint(): void {
    if (!this.foldStateManager) return;

    const nextLine = this.foldStateManager.getNextFoldLine();

    if (nextLine) {
      const lineElement = this.container.querySelector(`[data-line-id="${nextLine.id}"]`);
      if (lineElement) {
        lineElement.classList.add('hint');
        setTimeout(() => {
          lineElement.classList.remove('hint');
        }, 2000);
      }
      this.showMessage(`💡 下一步：第 ${nextLine.order} 步 - ${nextLine.type === 'valley' ? '谷折' : '山折'}`, 'info');
    } else {
      this.showMessage('折叠已经完成，可以选择模型并提交答案。', 'info');
    }
  }

  private nextQuestion(): void {
    this.currentQuestionIndex++;
    this.loadQuestion(this.currentQuestionIndex);

    if (this.nextBtn) {
      this.nextBtn.style.display = 'none';
    }
    this.hideMessage();
  }

  private updateSubmitState(): void {
    if (!this.submitBtn) return;

    const canSubmit =
      this.state.gameStatus === 'playing' &&
      Boolean(this.state.selectedModelId) &&
      Boolean(this.foldStateManager?.isComplete());

    this.submitBtn.disabled = !canSubmit;
  }

  private formatFoldType(type: 'valley' | 'mountain'): string {
    return type === 'valley' ? '谷折' : '山折';
  }

  private updateUI(): void {
    this.updateScoreDisplay();
    this.updateStepsDisplay();
    this.updateQuestionInfo();
    this.updateTrainingDisplay();
    this.updateQuestionDifficulty();
  }

  private updateScoreDisplay(): void {
    const scoreDisplay = this.container.querySelector('#score-display');
    if (scoreDisplay) {
      scoreDisplay.textContent = String(this.state.score);
    }
  }

  private updateStepsDisplay(): void {
    const stepsDisplay = this.container.querySelector('#steps-display');
    if (stepsDisplay && this.state.currentQuestion) {
      stepsDisplay.textContent = `${this.state.stepsUsed}/${this.state.currentQuestion.maxSteps}`;
    }
  }

  private updateQuestionInfo(): void {
    const nameEl = this.container.querySelector('#question-name');
    const descEl = this.container.querySelector('#question-desc');

    if (nameEl && this.state.currentQuestion) {
      nameEl.textContent = this.state.currentQuestion.name;
    }
    if (descEl && this.state.currentQuestion) {
      descEl.textContent = this.state.currentQuestion.description;
    }
  }

  private showMessage(message: string, type: 'info' | 'success' | 'error'): void {
    const resultEl = this.container.querySelector('#result-message') as HTMLElement;
    if (resultEl) {
      resultEl.textContent = message;
      resultEl.className = `result-message ${type}`;
      resultEl.style.display = 'block';
    }
  }

  private hideMessage(): void {
    const resultEl = this.container.querySelector('#result-message') as HTMLElement;
    if (resultEl) {
      resultEl.style.display = 'none';
    }
  }

  private getMaxDifficulty(): number {
    return Math.max(...questionBank.map(q => q.difficulty));
  }

  private getQuestionCountByDifficulty(difficulty: number): number {
    return questionBank.filter(q => q.difficulty === difficulty).length;
  }

  private showTrainingSelection(): void {
    this.state.gameStatus = 'selecting';
    const maxDiff = this.getMaxDifficulty();

    let difficultyOptions = '';
    for (let i = 1; i <= maxDiff; i++) {
      const count = this.getQuestionCountByDifficulty(i);
      const stars = '⭐'.repeat(i);
      difficultyOptions += `
        <div class="difficulty-option" data-difficulty="${i}">
          <div class="difficulty-stars">${stars}</div>
          <div class="difficulty-label">难度 ${i}</div>
          <div class="difficulty-count">${count} 道题</div>
        </div>
      `;
    }

    this.container.innerHTML = `
      <div class="game-container">
        <div class="game-header">
          <h1>🎯 3D 折纸挑战</h1>
          <div class="game-stats">
            <span class="stat-item">
              <span class="stat-label">总分</span>
              <span class="stat-value">${this.state.score}</span>
            </span>
          </div>
        </div>

        <div class="training-selection">
          <h2>🏋️ 选择训练模式</h2>
          <p class="training-desc">选择适合你的训练方式，提升折纸技能！</p>

          <div class="training-modes">
            <div class="mode-card" data-mode="all">
              <div class="mode-icon">🎲</div>
              <div class="mode-title">全部题目</div>
              <div class="mode-desc">随机练习所有难度的题目</div>
              <div class="mode-count">共 ${questionBank.length} 道</div>
            </div>

            <div class="mode-card" data-mode="single">
              <div class="mode-icon">🎯</div>
              <div class="mode-title">单一难度</div>
              <div class="mode-desc">专注练习特定难度</div>
              <div class="mode-count">选择难度</div>
            </div>

            <div class="mode-card" data-mode="progressive">
              <div class="mode-icon">📈</div>
              <div class="mode-title">渐进训练</div>
              <div class="mode-desc">从易到难逐步提升</div>
              <div class="mode-count">难度递增</div>
            </div>
          </div>

          <div class="difficulty-selector" style="display: none;">
            <h3>选择难度级别</h3>
            <div class="difficulty-options">
              ${difficultyOptions}
            </div>
            <button class="btn btn-secondary back-btn" id="back-to-modes">← 返回选择模式</button>
          </div>

          <div class="progressive-config" style="display: none;">
            <h3>设置渐进范围</h3>
            <div class="range-config">
              <div class="range-item">
                <label>起始难度</label>
                <select id="start-difficulty" class="difficulty-select">
                  ${Array.from({ length: maxDiff }, (_, i) => `<option value="${i + 1}">难度 ${i + 1} - ${'⭐'.repeat(i + 1)}</option>`).join('')}
                </select>
              </div>
              <div class="range-item">
                <label>目标难度</label>
                <select id="end-difficulty" class="difficulty-select">
                  ${Array.from({ length: maxDiff }, (_, i) => `<option value="${i + 1}" ${i === maxDiff - 1 ? 'selected' : ''}>难度 ${i + 1} - ${'⭐'.repeat(i + 1)}</option>`).join('')}
                </select>
              </div>
            </div>
            <button class="btn btn-secondary back-btn" id="back-to-modes-2">← 返回选择模式</button>
          </div>

          <div class="start-training-area" style="display: none;">
            <button class="btn btn-primary btn-large" id="start-training-btn">🚀 开始训练</button>
          </div>
        </div>
      </div>
    `;

    this.bindTrainingEvents();
  }

  private bindTrainingEvents(): void {
    const modeCards = this.container.querySelectorAll('.mode-card');
    modeCards.forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.getAttribute('data-mode') as TrainingMode;
        this.selectTrainingMode(mode);
      });
    });

    const backBtn1 = this.container.querySelector('#back-to-modes');
    const backBtn2 = this.container.querySelector('#back-to-modes-2');
    [backBtn1, backBtn2].forEach(btn => {
      btn?.addEventListener('click', () => {
        this.showModeSelection();
      });
    });

    const difficultyOptions = this.container.querySelectorAll('.difficulty-option');
    difficultyOptions.forEach(option => {
      option.addEventListener('click', () => {
        const diff = parseInt(option.getAttribute('data-difficulty') || '1');
        this.selectSingleDifficulty(diff);
      });
    });

    const startBtn = this.container.querySelector('#start-training-btn');
    startBtn?.addEventListener('click', () => {
      this.startTraining();
    });

    const startSelect = this.container.querySelector('#start-difficulty') as HTMLSelectElement;
    const endSelect = this.container.querySelector('#end-difficulty') as HTMLSelectElement;
    if (startSelect && endSelect) {
      startSelect.addEventListener('change', () => {
        const startVal = parseInt(startSelect.value);
        const endVal = parseInt(endSelect.value);
        if (startVal > endVal) {
          endSelect.value = startVal.toString();
        }
      });
      endSelect.addEventListener('change', () => {
        const startVal = parseInt(startSelect.value);
        const endVal = parseInt(endSelect.value);
        if (endVal < startVal) {
          startSelect.value = endVal.toString();
        }
      });
    }
  }

  private selectTrainingMode(mode: TrainingMode): void {
    this.state.trainingConfig.mode = mode;

    const modeCards = this.container.querySelectorAll('.mode-card');
    modeCards.forEach(card => card.classList.remove('selected'));
    const selectedCard = this.container.querySelector(`[data-mode="${mode}"]`);
    selectedCard?.classList.add('selected');

    if (mode === 'all') {
      this.state.trainingConfig.minDifficulty = 1;
      this.state.trainingConfig.maxDifficulty = this.getMaxDifficulty();
      this.state.trainingConfig.targetDifficulty = null;
      this.showStartButton();
    } else if (mode === 'single') {
      this.showDifficultySelector();
    } else if (mode === 'progressive') {
      this.showProgressiveConfig();
    }
  }

  private showModeSelection(): void {
    const diffSelector = this.container.querySelector('.difficulty-selector') as HTMLElement;
    const progConfig = this.container.querySelector('.progressive-config') as HTMLElement;
    const startArea = this.container.querySelector('.start-training-area') as HTMLElement;
    const modeCards = this.container.querySelector('.training-modes') as HTMLElement;

    if (diffSelector) diffSelector.style.display = 'none';
    if (progConfig) progConfig.style.display = 'none';
    if (startArea) startArea.style.display = 'none';
    if (modeCards) modeCards.style.display = 'grid';
  }

  private showDifficultySelector(): void {
    const modeCards = this.container.querySelector('.training-modes') as HTMLElement;
    const diffSelector = this.container.querySelector('.difficulty-selector') as HTMLElement;
    const startArea = this.container.querySelector('.start-training-area') as HTMLElement;

    if (modeCards) modeCards.style.display = 'none';
    if (diffSelector) diffSelector.style.display = 'block';
    if (startArea) startArea.style.display = 'none';
  }

  private selectSingleDifficulty(difficulty: number): void {
    this.state.trainingConfig.targetDifficulty = difficulty;
    this.state.trainingConfig.minDifficulty = difficulty;
    this.state.trainingConfig.maxDifficulty = difficulty;

    const diffOptions = this.container.querySelectorAll('.difficulty-option');
    diffOptions.forEach(opt => opt.classList.remove('selected'));
    const selectedOpt = this.container.querySelector(`[data-difficulty="${difficulty}"]`);
    selectedOpt?.classList.add('selected');

    this.showStartButton();
  }

  private showProgressiveConfig(): void {
    const modeCards = this.container.querySelector('.training-modes') as HTMLElement;
    const progConfig = this.container.querySelector('.progressive-config') as HTMLElement;
    const startArea = this.container.querySelector('.start-training-area') as HTMLElement;

    if (modeCards) modeCards.style.display = 'none';
    if (progConfig) progConfig.style.display = 'block';
    if (startArea) startArea.style.display = 'block';

    const startSelect = this.container.querySelector('#start-difficulty') as HTMLSelectElement;
    const endSelect = this.container.querySelector('#end-difficulty') as HTMLSelectElement;
    if (startSelect && endSelect) {
      this.state.trainingConfig.minDifficulty = parseInt(startSelect.value);
      this.state.trainingConfig.maxDifficulty = parseInt(endSelect.value);
    }
  }

  private showStartButton(): void {
    const startArea = this.container.querySelector('.start-training-area') as HTMLElement;
    if (startArea) {
      startArea.style.display = 'block';
    }
  }

  private startTraining(): void {
    if (this.state.trainingConfig.mode === 'progressive') {
      const startSelect = this.container.querySelector('#start-difficulty') as HTMLSelectElement;
      const endSelect = this.container.querySelector('#end-difficulty') as HTMLSelectElement;
      if (startSelect && endSelect) {
        this.state.trainingConfig.minDifficulty = parseInt(startSelect.value);
        this.state.trainingConfig.maxDifficulty = parseInt(endSelect.value);
        this.state.trainingConfig.currentDifficultyLevel = this.state.trainingConfig.minDifficulty;
      }
    }

    this.state.level = 1;
    this.buildQuestionPool();
    this.initGameUI();
    this.loadQuestion(0);
  }

  private buildQuestionPool(): void {
    const config = this.state.trainingConfig;

    if (config.mode === 'all') {
      this.questionPool = this.rng.shuffle([...questionBank]);
    } else if (config.mode === 'single' && config.targetDifficulty !== null) {
      this.questionPool = this.rng.shuffle(
        questionBank.filter(q => q.difficulty === config.targetDifficulty)
      );
    } else if (config.mode === 'progressive') {
      this.questionPool = this.rng.shuffle(
        questionBank.filter(
          q => q.difficulty >= config.minDifficulty && q.difficulty <= config.currentDifficultyLevel
        )
      );
    }

    this.currentQuestionIndex = 0;
  }

  private getRemainingQuestions(): number {
    if (this.state.trainingConfig.mode === 'progressive') {
      const remainingInCurrent = this.questionPool.length - this.currentQuestionIndex;
      let remainingHigher = 0;
      for (let d = this.state.trainingConfig.currentDifficultyLevel + 1; d <= this.state.trainingConfig.maxDifficulty; d++) {
        remainingHigher += this.getQuestionCountByDifficulty(d);
      }
      return remainingInCurrent + remainingHigher;
    }
    return Math.max(0, this.questionPool.length - this.currentQuestionIndex);
  }

  private getTrainingRangeText(): string {
    const config = this.state.trainingConfig;
    if (config.mode === 'all') {
      return '全部难度';
    } else if (config.mode === 'single') {
      return `难度 ${config.targetDifficulty} (${'⭐'.repeat(config.targetDifficulty || 1)})`;
    } else {
      return `难度 ${config.minDifficulty}-${config.maxDifficulty} (当前: ${config.currentDifficultyLevel})`;
    }
  }

  private initGameUI(): void {
    this.container.innerHTML = `
      <div class="game-container">
        <div class="game-header">
          <h1>🎯 3D 折纸挑战</h1>
          <div class="game-stats">
            <span class="stat-item">
              <span class="stat-label">训练范围</span>
              <span class="stat-value stat-value-wide" id="training-range-display">全部难度</span>
            </span>
            <span class="stat-item">
              <span class="stat-label">剩余题目</span>
              <span class="stat-value" id="remaining-display">0</span>
            </span>
            <span class="stat-item">
              <span class="stat-label">得分</span>
              <span class="stat-value" id="score-display">0</span>
            </span>
            <span class="stat-item">
              <span class="stat-label">步数</span>
              <span class="stat-value" id="steps-display">0/0</span>
            </span>
          </div>
        </div>

        <div class="game-main">
          <div class="left-panel">
            <div class="panel-title">📐 折痕图</div>
            <div class="question-info">
              <h2 id="question-name">题目名称</h2>
              <p id="question-desc">题目描述</p>
              <div class="question-difficulty" id="question-difficulty"></div>
            </div>
            <div class="svg-container" id="svg-container"></div>
            <div class="action-buttons">
              <button class="btn btn-secondary" id="reset-btn">🔄 重置</button>
              <button class="btn btn-secondary" id="hint-btn">💡 提示</button>
              <button class="btn btn-secondary" id="training-btn">🏋️ 训练模式</button>
            </div>
          </div>

          <div class="right-panel">
            <div class="panel-title">🧩 选择正确的3D模型</div>
            <div class="models-container" id="models-container"></div>
            <div class="submit-area">
              <button class="btn btn-primary" id="submit-btn" disabled>✅ 提交答案</button>
            </div>
          </div>
        </div>

        <div class="game-footer">
          <button class="btn btn-next" id="next-btn" style="display: none;">➡️ 下一题</button>
          <div class="result-message" id="result-message"></div>
        </div>
      </div>
    `;

    this.modelsContainer = this.container.querySelector('#models-container');
    this.submitBtn = this.container.querySelector('#submit-btn');
    this.resetBtn = this.container.querySelector('#reset-btn');
    this.hintBtn = this.container.querySelector('#hint-btn');
    this.nextBtn = this.container.querySelector('#next-btn');
    this.trainingBtn = this.container.querySelector('#training-btn');

    this.submitBtn?.addEventListener('click', () => this.checkAnswer());
    this.resetBtn?.addEventListener('click', () => this.resetFolds());
    this.hintBtn?.addEventListener('click', () => this.showHint());
    this.nextBtn?.addEventListener('click', () => this.nextQuestion());
    this.trainingBtn?.addEventListener('click', () => this.showTrainingSelection());
  }

  private updateTrainingDisplay(): void {
    const rangeDisplay = this.container.querySelector('#training-range-display');
    const remainingDisplay = this.container.querySelector('#remaining-display');

    if (rangeDisplay) {
      rangeDisplay.textContent = this.getTrainingRangeText();
    }
    if (remainingDisplay) {
      remainingDisplay.textContent = String(this.getRemainingQuestions());
    }
  }

  private updateQuestionDifficulty(): void {
    const diffEl = this.container.querySelector('#question-difficulty');
    if (diffEl && this.state.currentQuestion) {
      const stars = '⭐'.repeat(this.state.currentQuestion.difficulty);
      diffEl.textContent = `难度: ${stars}`;
    }
  }

  getState(): GameState {
    return { ...this.state };
  }

  destroy(): void {
    this.origamiSVG?.destroy();
    this.modelViewers.forEach(viewer => viewer.destroy());
    this.container.innerHTML = '';
  }
}
