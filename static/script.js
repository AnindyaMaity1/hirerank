// Advanced Resume Ranker - Production Grade Frontend
class ResumeRanker {
  constructor() {
    this.maxFiles = 10;
    this.maxFileSize = 5 * 1024 * 1024; // 5MB
    this.freeLimit = 10;                // total resumes allowed in free tier

    this.initElements();
    this.restoreState();                // restore JD, results, status, usage
    this.bindEvents();
    this.updateUsageUI();               // reflect current usage on load
  }

  initElements() {
    this.jobDesc = document.getElementById('jobDesc');
    this.resumeInput = document.getElementById('resumeInput');
    this.dropZone = document.getElementById('dropZone');
    this.fileList = document.getElementById('fileList');
    this.rankingForm = document.getElementById('rankingForm');
    this.rankBtn = document.getElementById('rankBtn');
    this.results = document.getElementById('results');
    this.statusIndicator = document.getElementById('statusIdle');

    // SaaS / paywall UI hooks
    this.usageInfo = document.getElementById('usageInfo');
    this.freeTierBanner = document.getElementById('freeTierBanner');
    this.paywallPanel = document.getElementById('paywallPanel');
    this.upgradeHint = document.getElementById('upgradeHint');
    this.upgradeBtn = document.getElementById('upgradeBtn');

    // usage count of analyzed resumes (stored in localStorage)
    const storedUsage = Number(localStorage.getItem('hirerank_usage') || '0');
    this.usedCount = Number.isNaN(storedUsage) ? 0 : storedUsage;
  }

  bindEvents() {
    // Form submission
    this.rankingForm.addEventListener('submit', (e) => this.handleSubmit(e));

    // File input change
    this.resumeInput.addEventListener('change', (e) =>
      this.handleFiles(e.target.files)
    );

    // Drag & drop
    this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
    this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
    this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));

    // JD typing -> save
    this.jobDesc.addEventListener('input', () => this.saveState());

    // Reset form (only current inputs, not usage history)
    this.rankingForm.addEventListener('reset', () => this.resetForm());

    // Upgrade CTA (placeholder)
    if (this.upgradeBtn) {
      this.upgradeBtn.addEventListener('click', () => {
        this.showNotification(
          'Payment flow coming soon. Contact sales for early access.',
          'info'
        );
      });
    }
  }

  /* ===== STATE PERSISTENCE (UI, NOT FILES) ===== */
  saveState() {
    const state = {
      jobDesc: this.jobDesc.value || '',
      resultsHtml: this.results.innerHTML || '',
      statusText: this.statusIndicator?.textContent || 'Ready to analyze',
      usedCount: this.usedCount,
    };
    try {
      localStorage.setItem('hirerank_state', JSON.stringify(state));
      localStorage.setItem('hirerank_usage', String(this.usedCount));
    } catch (_) {
      // ignore storage errors
    }
  }

  restoreState() {
    let raw;
    try {
      raw = localStorage.getItem('hirerank_state');
    } catch (_) {
      return;
    }
    if (!raw) return;

    try {
      const state = JSON.parse(raw);
      if (state.jobDesc) this.jobDesc.value = state.jobDesc;
      if (state.resultsHtml) this.results.innerHTML = state.resultsHtml;
      if (state.statusText) this.statusIndicator.textContent = state.statusText;
      if (typeof state.usedCount === 'number') {
        this.usedCount = state.usedCount;
      }
    } catch (_) {
      // ignore corrupted state
    }
  }

  // Only clears UI state (JD/results/status), NOT usage history
  clearStateForSession() {
    try {
      const raw = localStorage.getItem('hirerank_state');
      if (!raw) return;
      const state = JSON.parse(raw);
      // preserve usedCount; wipe per-session fields
      const newState = {
        jobDesc: '',
        resultsHtml: '',
        statusText: 'Ready to analyze',
        usedCount: state.usedCount ?? this.usedCount,
      };
      localStorage.setItem('hirerank_state', JSON.stringify(newState));
      // keep hirerank_usage as-is
    } catch (_) {
      // ignore
    }
  }

  /* ===== USAGE / PAYWALL LOGIC ===== */
  updateUsageUI() {
    if (this.usageInfo) {
      const capped = Math.min(this.usedCount, this.freeLimit);
      this.usageInfo.textContent = `🎁 Free: ${capped} / ${this.freeLimit} resumes analyzed`;
    }

    const overLimit = this.usedCount >= this.freeLimit;

    if (overLimit) {
      // Lock analysis
      this.rankBtn.disabled = true;
      this.rankBtn.textContent = 'Free limit reached';
      if (this.paywallPanel) this.paywallPanel.style.display = 'block';
      if (this.upgradeHint) this.upgradeHint.style.display = 'block';
      if (this.freeTierBanner) this.freeTierBanner.style.opacity = '0.6';
    } else {
      this.rankBtn.disabled = false;
      this.rankBtn.textContent = 'Analyze Resumes with AI';
      if (this.paywallPanel) this.paywallPanel.style.display = 'none';
      if (this.upgradeHint) this.upgradeHint.style.display = 'none';
      if (this.freeTierBanner) this.freeTierBanner.style.opacity = '1';
    }
  }

  incrementUsage(byCount) {
    this.usedCount += byCount;
    this.saveState();
    this.updateUsageUI();
  }

  /* ===== FILE HANDLING ===== */
  handleDragOver(e) {
    e.preventDefault();
    this.dropZone.classList.add('dragover');
  }

  handleDragLeave(e) {
    e.preventDefault();
    this.dropZone.classList.remove('dragover');
  }

  handleDrop(e) {
    e.preventDefault();
    this.dropZone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files) {
      this.handleFiles(e.dataTransfer.files);
    }
  }

  handleFiles(files) {
    const allFiles = Array.from(files);
    const validFiles = allFiles.filter((file) => this.validateFile(file));

    if (validFiles.length === 0) {
      this.showNotification(
        'No valid files selected. Please use PDF, DOCX, or TXT (max 5MB).',
        'error'
      );
      return;
    }

    if (validFiles.length > this.maxFiles) {
      this.showNotification(
        `Maximum ${this.maxFiles} files allowed at once.`,
        'error'
      );
      validFiles.length = this.maxFiles;
    }

    this.updateFileList(validFiles);
  }

  validateFile(file) {
    const allowedTypes = ['.pdf', '.docx', '.txt'];
    const extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    return allowedTypes.includes(extension) && file.size <= this.maxFileSize;
  }

  updateFileList(files) {
    this.fileList.innerHTML = '';
    files.forEach((file, index) => {
      const fileItem = document.createElement('div');
      fileItem.className = 'file-item valid';
      fileItem.innerHTML = `📄 ${file.name} <span>(${this.formatFileSize(
        file.size
      )})</span>`;
      fileItem.dataset.index = index;
      this.fileList.appendChild(fileItem);
    });

    const dt = new DataTransfer();
    files.forEach((file) => dt.items.add(file));
    this.resumeInput.files = dt.files;
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /* ===== SUBMIT / API ===== */
  async handleSubmit(e) {
    e.preventDefault();

    const jdText = this.jobDesc.value.trim();
    const files = this.resumeInput.files;

    if (!jdText) {
      this.showNotification('Please enter job description.', 'error');
      return;
    }

    if (!files || files.length === 0) {
      this.showNotification('Please upload at least one resume.', 'error');
      return;
    }

    // Enforce free limit before calling backend
    if (this.usedCount >= this.freeLimit) {
      this.updateUsageUI();
      this.showNotification(
        'Free limit reached. Please upgrade to analyze more resumes.',
        'error'
      );
      return;
    }

    // If user tries to send more files than remaining free quota, block and show message
    const remaining = this.freeLimit - this.usedCount;
    if (files.length > remaining) {
      this.showNotification(
        `Free tier left: ${remaining} resume${remaining !== 1 ? 's' : ''}. Please reduce selection or upgrade.`,
        'error'
      );
      return;
    }

    await this.rankResumes(jdText, files);
  }

  async rankResumes(jdText, files) {
    this.setStatus('processing', '🔄 Analyzing resumes with AI...');
    this.rankBtn.disabled = true;
    this.rankBtn.textContent = 'Processing...';

    const formData = new FormData();
    formData.append('job_description', jdText);
    for (let file of files) {
      formData.append('resumes', file);
    }

    try {
      const response = await fetch('/rank', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        this.renderResults(data.results);
        // increment usage by number of resumes analyzed this time
        this.incrementUsage(files.length);
        this.setStatus(
          'complete',
          `✅ Ranked ${data.results.length} resumes successfully!`
        );
      } else {
        throw new Error(data.error || 'Analysis failed');
      }
    } catch (error) {
      console.error('Ranking error:', error);
      this.setStatus('idle', '❌ Analysis failed. Please try again.');
      this.showNotification(`Error: ${error.message}`, 'error');
    } finally {
      // Only re-enable if still under limit
      this.updateUsageUI();
    }
  }

  /* ===== RESULTS RENDERING ===== */
  renderResults(results) {
    results.sort((a, b) => b.overallScore - a.overallScore);

    this.results.innerHTML = `
      <div class="results-container">
        <h3>Ranked Candidates</h3>
        <div class="results-grid">
          ${results
            .map((item, index) => this.createRankCard(item, index + 1))
            .join('')}
        </div>
      </div>
    `;

    this.saveState(); // keep results after refresh
  }

  createRankCard(item, rank) {
    const scoreClass =
      item.overallScore >= 90
        ? 'score-90'
        : item.overallScore >= 80
        ? 'score-80'
        : item.overallScore >= 70
        ? 'score-70'
        : 'score-below';

    const rankClass =
      rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : '';

    return `
      <div class="rank-card">
        <div class="rank-header">
          <div>
            <div class="rank-badge ${rankClass}">
              #${rank} ${this.getRankLabel(rank)}
            </div>
            <h3 style="margin: 8px 0 0 0; color: #1e293b;">${item.filename}</h3>
          </div>
          <div class="score-circle ${scoreClass}">
            ${item.overallScore}%
          </div>
        </div>

        <div class="breakdown">
          <div class="metric">
            <div class="metric-label">Skills</div>
            <div class="metric-value">${item.breakdown.skillsMatch}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Experience</div>
            <div class="metric-value">${item.breakdown.experience}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Education</div>
            <div class="metric-value">${item.breakdown.education}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">ATS</div>
            <div class="metric-value">${item.breakdown.atsScore}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Career Fit</div>
            <div class="metric-value">${item.breakdown.careerFit}%</div>
          </div>
        </div>

        ${
          item.strengths?.length
            ? `
          <div class="strengths">
            <h4>✅ Strengths</h4>
            <div class="strengths-list">
              ${item.strengths
                .map((s) => `<span class="strength-tag">${s}</span>`)
                .join('')}
            </div>
          </div>
        `
            : ''
        }

        ${
          item.gaps?.length
            ? `
          <div class="gaps">
            <h4>⚠️ Skill Gaps</h4>
            <div class="gaps-list">
              ${item.gaps
                .map((g) => `<span class="gap-tag">${g}</span>`)
                .join('')}
            </div>
          </div>
        `
            : ''
        }

        <div class="recommendation" style="border-left-color: ${this.getRecommendationColor(
          item.recommendation
        )}">
          💡 ${item.recommendation}
        </div>
      </div>
    `;
  }

  getRankLabel(rank) {
    return rank === 1
      ? '🏆 Top Choice'
      : rank === 2
      ? '🥈 Strong Fit'
      : rank === 3
      ? '🥉 Good Match'
      : 'Consider';
  }

  getRecommendationColor(recommendation) {
    if (
      recommendation.includes('Top') ||
      recommendation.includes('Fast Track')
    )
      return '#10b981';
    if (recommendation.includes('Strong')) return '#3b82f6';
    if (recommendation.includes('Good')) return '#f59e0b';
    return '#ef4444';
  }

  setStatus(type, message) {
    this.statusIndicator.textContent = message;
    this.statusIndicator.id = `status${type
      .charAt(0)
      .toUpperCase() + type.slice(1)}`;
    this.saveState(); // also persist status and usage
  }

  showNotification(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; top: 20px; right: 20px; padding: 16px 20px;
      background: ${type === 'error' ? '#fee2e2' : '#d1fae5'};
      color: ${type === 'error' ? '#991b1b' : '#065f46'};
      border-radius: 8px; font-weight: 600; z-index: 10000;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 4000);
  }

  // Reset only JD, files, and current results; keep usage history
  resetForm() {
    this.fileList.innerHTML = '';
    this.results.innerHTML = '';
    this.resumeInput.value = null;
    this.jobDesc.value = '';
    this.setStatus('idle', 'Ready to analyze');
    this.clearStateForSession();  // reset saved JD/results/status but keep usedCount
    this.updateUsageUI();         // usage stays the same, button state reflects limit
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.rankResumes = new ResumeRanker();
});
