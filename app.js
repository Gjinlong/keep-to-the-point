// 配置PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';

new Vue({
    el: '#app',
    data: {
        pdfDoc: null,
        currentPage: 1,
        jumpToPage: 1,  // 添加跳转页码数据
        scale: 1.0,
        boxes: [],
        isDragging: false,
        isResizing: false,
        isDrawing: false,
        currentBox: null,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        boxId: 1,
        pageOffsets: [], // 存储每页的垂直偏移量
        pageDimensions: [], // 存储每页的尺寸信息
        pixelToCmRatio: 1, // 像素到厘米的转换比例
        drawStartX: 0,
        drawStartY: 0,
        currentPageNum: 0,
        currentPageOffset: 0,
        currentCanvas: null,
        currentCanvasRect: null,
        sizeIndicator: null,
        currentQuestion: {
            type: 'single',
            stem: '',
            options: ['', '', '', ''],
            answer: '',
            boxes: []
        },
        questions: []
    },
    mounted() {
        this.loadPDF('https://cos.zlss.vip/uploads/admin/202501/627736f37b9ae9ec3fd7bbdb45520688.pdf');
        this.initializeEventListeners();
    },
    methods: {
        async loadPDF(url) {
            try {
                const loadingTask = pdfjsLib.getDocument(url);
                this.pdfDoc = await loadingTask.promise;
                await this.calculatePageDimensions();
                await this.renderAllPages();
                // 生成随机框数据
                this.generateRandomBoxes();
            } catch (error) {
                console.error('Error loading PDF:', error);
                this.$message.error('PDF加载失败');
            }
        },

        pixelToMm(pixels) {
            // 转换为毫米并四舍五入到整数
            return Math.round(pixels * this.pixelToCmRatio);
        },

        async calculatePageDimensions() {
            this.pageDimensions = [];
            for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
                const page = await this.pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1.0 }); // 使用1.0比例获取原始尺寸
                
                // PDF点数到毫米的转换 (1点 = 0.352778毫米)
                const pointToMm = 0.352778;
                const widthInMm = viewport.width * pointToMm;
                const heightInMm = viewport.height * pointToMm;
                
                // 计算适配1920*1082屏幕的缩放比例
                const containerWidth = 1920 - 800; // 减去右侧信息面板的宽度
                const containerHeight = 1082 - 40; // 减去上下边距
                const scaleX = containerWidth / viewport.width;
                const scaleY = containerHeight / viewport.height;
                this.scale = Math.min(scaleX, scaleY);
                
                // 使用计算出的缩放比例的视口
                const scaledViewport = page.getViewport({ scale: this.scale });
                
                // 计算像素到毫米的转换比例
                this.pixelToCmRatio = widthInMm / scaledViewport.width;
                
                this.pageDimensions.push({
                    width: scaledViewport.width,
                    height: scaledViewport.height,
                    widthInMm: Math.round(widthInMm),
                    heightInMm: Math.round(heightInMm),
                    originalWidth: viewport.width,
                    originalHeight: viewport.height
                });
            }
        },

        async renderAllPages() {
            const pdfViewer = document.getElementById('pdf-viewer');
            pdfViewer.innerHTML = '';
            this.pageOffsets = []; // 重置页面偏移量数组

            for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
                try {
                    const page = await this.pdfDoc.getPage(pageNum);
                    const viewport = page.getViewport({ scale: this.scale });
                    
                    const pageDiv = document.createElement('div');
                    pageDiv.className = 'pdf-page';
                    pageDiv.setAttribute('data-page-number', pageNum);
                    
                    // 添加页码显示
                    const pageInfo = document.createElement('div');
                    pageInfo.style.position = 'absolute';
                    pageInfo.style.top = '10px';
                    pageInfo.style.right = '10px';
                    pageInfo.style.background = 'rgba(0, 0, 0, 0.5)';
                    pageInfo.style.color = 'white';
                    pageInfo.style.padding = '5px 10px';
                    pageInfo.style.borderRadius = '4px';
                    pageInfo.style.fontSize = '14px';
                    const dimensions = this.pageDimensions[pageNum-1];
                    pageInfo.textContent = `第${pageNum}页 - ${dimensions.widthInMm}×${dimensions.heightInMm}`;
                    
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    
                    pageDiv.appendChild(canvas);
                    pageDiv.appendChild(pageInfo);
                    pdfViewer.appendChild(pageDiv);

                    await page.render({
                        canvasContext: context,
                        viewport: viewport
                    }).promise;

                    // 记录每页的垂直偏移量和元素
                    this.pageOffsets.push({
                        top: pageDiv.offsetTop,
                        element: pageDiv
                    });
                } catch (error) {
                    console.error(`Error rendering page ${pageNum}:`, error);
                }
            }
        },

        initializeEventListeners() {
            document.addEventListener('mousemove', this.handleMouseMove);
            document.addEventListener('mouseup', this.handleMouseUp);
            
            const pdfViewer = document.getElementById('pdf-viewer');
            pdfViewer.addEventListener('mousedown', this.handlePdfClick);
        },

        handlePdfClick(event) {
            // 检查点击的元素是否是 canvas
            const targetElement = event.target;
            if (!targetElement.tagName || targetElement.tagName.toLowerCase() !== 'canvas') {
                return;
            }

            // 获取包含canvas的页面div
            const pageDiv = targetElement.parentElement;
            const page = parseInt(pageDiv.getAttribute('data-page-number'));
            
            // 获取相对于canvas的坐标
            const rect = targetElement.getBoundingClientRect();
            const scrollTop = targetElement.parentElement.parentElement.scrollTop;
            
            // 保存当前页面和canvas信息
            this.currentPageNum = page;
            this.currentPageOffset = this.pageOffsets[page-1].top;
            this.currentCanvas = targetElement;
            this.currentCanvasRect = rect;
            
            // 创建尺寸指示器
            if (!this.sizeIndicator) {
                this.sizeIndicator = document.createElement('div');
                this.sizeIndicator.className = 'box-size-indicator';
                document.body.appendChild(this.sizeIndicator);
            }
            
            // 开始绘制
            this.isDrawing = true;
            this.drawStartX = event.clientX - rect.left;
            this.drawStartY = event.clientY - rect.top;
            
            // 创建新框但不立即添加到数组中
            this.currentBox = {
                id: this.boxId,
                x: this.drawStartX,
                y: this.drawStartY + this.currentPageOffset,
                width: 0,
                height: 0,
                page,
                pageOffset: this.currentPageOffset,
                relativeY: this.drawStartY,
                xInMm: this.pixelToMm(this.drawStartX),
                yInMm: this.pixelToMm(this.drawStartY),
                widthInMm: 0,
                heightInMm: 0
            };
        },

        getPageNumberFromY(y) {
            // 根据y坐标确定页码
            let pageNum = 1;
            for (let i = 0; i < this.pageOffsets.length; i++) {
                if (y >= this.pageOffsets[i].top) {
                    pageNum = i + 1;
                }
            }
            return pageNum;
        },

        startDrag(event, box) {
            if (event.target.classList.contains('box-resize-handle')) return;
            
            this.isDragging = true;
            this.currentBox = box;
            const pdfViewer = document.getElementById('pdf-viewer');
            const rect = pdfViewer.getBoundingClientRect();
            const scrollTop = pdfViewer.parentElement.scrollTop;
            
            // 获取当前页的canvas元素
            const pageDiv = this.pageOffsets[box.page - 1].element;
            const canvas = pageDiv.querySelector('canvas');
            const canvasRect = canvas.getBoundingClientRect();
            
            // 计算鼠标点击位置相对于框的偏移
            this.startX = event.clientX - canvasRect.left - box.x;
            this.startY = event.clientY - canvasRect.top + scrollTop - (box.y - box.pageOffset);
            
            event.target.classList.add('dragging');
            event.stopPropagation();
        },

        startResize(event, box) {
            this.isResizing = true;
            this.currentBox = box;
            this.startX = event.clientX;
            this.startY = event.clientY;
            this.lastX = box.width;
            this.lastY = box.height;
            event.target.classList.add('resizing');
            event.stopPropagation();
        },

        handleMouseMove(event) {
            if (this.isDrawing && this.currentBox) {
                // 计算新的宽度和高度
                const currentX = event.clientX - this.currentCanvasRect.left;
                const currentY = event.clientY - this.currentCanvasRect.top;
                
                // 更新框的尺寸
                this.currentBox.width = Math.abs(currentX - this.drawStartX);
                this.currentBox.height = Math.abs(currentY - this.drawStartY);
                
                // 如果向左或向上拖动，需要调整起始位置
                if (currentX < this.drawStartX) {
                    this.currentBox.x = currentX;
                }
                if (currentY < this.drawStartY) {
                    this.currentBox.y = currentY + this.currentPageOffset;
                    this.currentBox.relativeY = currentY;
                }
                
                // 限制框的最大尺寸
                const maxWidth = this.pageDimensions[this.currentPageNum - 1].width - this.currentBox.x;
                const maxHeight = this.pageDimensions[this.currentPageNum - 1].height - this.currentBox.relativeY;
                
                this.currentBox.width = Math.min(this.currentBox.width, maxWidth);
                this.currentBox.height = Math.min(this.currentBox.height, maxHeight);
                
                // 更新毫米单位的尺寸
                this.currentBox.xInMm = this.pixelToMm(this.currentBox.x);
                this.currentBox.yInMm = this.pixelToMm(this.currentBox.relativeY);
                this.currentBox.widthInMm = this.pixelToMm(this.currentBox.width);
                this.currentBox.heightInMm = this.pixelToMm(this.currentBox.height);

                // 更新尺寸指示器
                if (this.sizeIndicator) {
                    const indicatorX = event.clientX + 10;
                    const indicatorY = event.clientY + 10;
                    
                    this.sizeIndicator.style.left = `${indicatorX}px`;
                    this.sizeIndicator.style.top = `${indicatorY}px`;
                    this.sizeIndicator.textContent = `${this.currentBox.widthInMm}×${this.currentBox.heightInMm}毫米`;
                    this.sizeIndicator.style.display = 'block';
                }
            } else if (this.isDragging && this.currentBox) {
                const pdfViewer = document.getElementById('pdf-viewer');
                const rect = pdfViewer.getBoundingClientRect();
                const scrollTop = pdfViewer.parentElement.scrollTop;
                
                const pageDiv = this.pageOffsets[this.currentBox.page - 1].element;
                const canvas = pageDiv.querySelector('canvas');
                const canvasRect = canvas.getBoundingClientRect();
                
                const x = event.clientX - canvasRect.left - this.startX;
                const y = event.clientY - canvasRect.top + scrollTop - this.startY;
                
                const newPage = this.getPageNumberFromY(y + this.currentBox.pageOffset);
                const newPageOffset = this.pageOffsets[newPage - 1].top;
                
                const maxX = this.pageDimensions[newPage - 1].width - this.currentBox.width;
                const maxY = newPage === this.pdfDoc.numPages 
                    ? this.pageDimensions[newPage - 1].height
                    : this.pageOffsets[newPage].top - newPageOffset - this.currentBox.height;
                
                this.currentBox.x = Math.max(0, Math.min(x, maxX));
                this.currentBox.y = newPageOffset + Math.max(0, Math.min(y, maxY));
                this.currentBox.page = newPage;
                this.currentBox.pageOffset = newPageOffset;
                this.currentBox.relativeY = this.currentBox.y - newPageOffset;
                
                this.currentBox.xInMm = this.pixelToMm(this.currentBox.x);
                this.currentBox.yInMm = this.pixelToMm(this.currentBox.relativeY);
            } else if (this.isResizing && this.currentBox) {
                const dx = event.clientX - this.startX;
                const dy = event.clientY - this.startY;
                
                const pageDiv = this.pageOffsets[this.currentBox.page - 1].element;
                const canvas = pageDiv.querySelector('canvas');
                
                const maxWidth = this.pageDimensions[this.currentBox.page - 1].width - this.currentBox.x;
                const maxHeight = this.currentBox.page === this.pdfDoc.numPages
                    ? this.pageDimensions[this.currentBox.page - 1].height - (this.currentBox.y - this.currentBox.pageOffset)
                    : this.pageOffsets[this.currentBox.page].top - this.currentBox.y;
                
                this.currentBox.width = Math.max(20, Math.min(this.lastX + dx, maxWidth));
                this.currentBox.height = Math.max(20, Math.min(this.lastY + dy, maxHeight));
                
                this.currentBox.widthInMm = this.pixelToMm(this.currentBox.width);
                this.currentBox.heightInMm = this.pixelToMm(this.currentBox.height);

                // 在调整大小时也显示尺寸信息
                if (this.sizeIndicator) {
                    const indicatorX = event.clientX + 10;
                    const indicatorY = event.clientY + 10;
                    
                    this.sizeIndicator.style.left = `${indicatorX}px`;
                    this.sizeIndicator.style.top = `${indicatorY}px`;
                    this.sizeIndicator.textContent = `${this.currentBox.widthInMm}×${this.currentBox.heightInMm}毫米`;
                    this.sizeIndicator.style.display = 'block';
                }
            }
        },

        handleMouseUp() {
            // 隐藏尺寸指示器
            if (this.sizeIndicator) {
                this.sizeIndicator.style.display = 'none';
            }
            
            if (this.isDrawing) {
                // 只有当框的宽度和高度都大于最小值时才添加到数组中
                if (this.currentBox && this.currentBox.width >= 20 && this.currentBox.height >= 20) {
                    this.boxId++;
                    this.boxes.push(this.currentBox);
                }
                this.isDrawing = false;
            }
            if (this.isDragging) {
                document.querySelector('.box-container.dragging')?.classList.remove('dragging');
            }
            if (this.isResizing) {
                document.querySelector('.box-resize-handle.resizing')?.classList.remove('resizing');
            }
            this.isDragging = false;
            this.isResizing = false;
            this.currentBox = null;
        },

        removeBox(boxId) {
            const index = this.boxes.findIndex(box => box.id === boxId);
            if (index !== -1) {
                this.boxes.splice(index, 1);
            }
        },

        addOption() {
            this.currentQuestion.options.push('');
        },

        removeOption(index) {
            this.currentQuestion.options.splice(index, 1);
        },

        saveQuestion() {
            // 在保存时添加每个框所在页面的原始尺寸信息
            const boxesWithDimensions = this.boxes.map(box => ({
                ...box,
                pageDimensions: this.pageDimensions[box.page - 1]
            }));

            const question = {
                ...this.currentQuestion,
                boxes: boxesWithDimensions
            };
            
            this.questions.push(question);
            this.$message.success('题目保存成功');
        },

        nextQuestion() {
            // 清空当前题目信息
            this.currentQuestion = {
                type: 'single',
                stem: '',
                options: ['', '', '', ''],
                answer: '',
                boxes: []
            };
            this.boxes = [];
            
            // 切换到下一页
            if (this.currentPage < this.pdfDoc.numPages) {
                this.currentPage++;
                this.renderAllPages();
            }
        },

        jumpToPageHandler() {
            if (!this.pdfDoc || !this.jumpToPage) return;
            
            // 确保页码在有效范围内
            const pageNum = Math.min(Math.max(1, this.jumpToPage), this.pdfDoc.numPages);
            
            // 获取目标页面的容器元素
            const targetPage = document.querySelector(`.pdf-page[data-page-number="${pageNum}"]`);
            if (targetPage) {
                // 获取PDF容器
                const container = document.querySelector('.pdf-container');
                // 平滑滚动到目标页面
                container.scrollTo({
                    top: targetPage.offsetTop - 20, // 减去顶部边距
                    behavior: 'smooth'
                });
            }
        },

        generateRandomBoxes() {
            // 清空现有的框数组
            this.boxes = [];
            
            // 添加特定的框数据到第一页（使用毫米单位）
            const pageOffset = this.pageOffsets[0].top;  // 获取第一页的顶部偏移量
            const pageDimensions = this.pageDimensions[0];  // 获取第一页的尺寸信息
            
            // 计算毫米到像素的转换比例
            // pageDimensions.width: 页面在屏幕上的像素宽度
            // pageDimensions.widthInMm: 页面的实际毫米宽度
            const mmToPixel = pageDimensions.width / pageDimensions.widthInMm;
            
            // 将毫米单位转换为像素单位
            // 13mm -> 像素
            const x = Math.round(13 * mmToPixel);
            // 62mm -> 像素
            const y = Math.round(62 * mmToPixel);
            // 126mm -> 像素
            const width = Math.round(126 * mmToPixel);
            // 34mm -> 像素
            const height = Math.round(34 * mmToPixel);
            
            // 创建特定框对象
            const specificBox = {
                id: this.boxId++,  // 框的唯一标识符
                x,                 // 框的左边距（像素）
                y: y + (this.pageOffsets[0].top - this.pageOffsets[0].top),  // 框的顶部位置（像素）
                width,            // 框的宽度（像素）
                height,           // 框的高度（像素）
                page: 1,          // 框所在的页码
                pageOffset,       // 当前页面的顶部偏移量
                relativeY: y,     // 相对于当前页面的顶部位置
                // 以下属性使用毫米单位
                xInMm: 13,        // 左边距（毫米）
                yInMm: 62,        // 顶部边距（毫米）
                widthInMm: 126,   // 宽度（毫米）
                heightInMm: 34    // 高度（毫米）
            };
            this.boxes.push(specificBox);


            const pageOffset1 = this.pageOffsets[1].top;  // 获取第一页的顶部偏移量
            const pageDimensions1 = this.pageDimensions[1];  // 获取第一页的尺寸信息
            const mmToPixel1 = pageDimensions.width / pageDimensions.widthInMm;

             // 将毫米单位转换为像素单位
            // 13mm -> 像素
            const x1 = Math.round(13 * mmToPixel1);
            // 62mm -> 像素
            const y1 = Math.round(102 * mmToPixel1);
            // 126mm -> 像素
            const width1 = Math.round(126 * mmToPixel1);
            // 34mm -> 像素
            const height1 = Math.round(34 * mmToPixel1);
             // 创建特定框对象
             const specificBox1 = {
                id: this.boxId++,  // 框的唯一标识符
                x: x1,                 // 框的左边距（像素）
                y: y1 + (this.pageOffsets[1].top - this.pageOffsets[1].top),  // 框的顶部位置（像素）
                width: width1,            // 框的宽度（像素）
                height: height1,           // 框的高度（像素）
                page:2,          // 框所在的页码
                pageOffset:pageOffset1,       // 当前页面的顶部偏移量
                relativeY: y1,     // 相对于当前页面的顶部位置
                // 以下属性使用毫米单位
                xInMm: 13,        // 左边距（毫米）
                yInMm: 102,        // 顶部边距（毫米）
                widthInMm: 126,   // 宽度（毫米）
                heightInMm: 34    // 高度（毫米）
            };
            this.boxes.push(specificBox1);
            
            console.log(this.boxes);

            // 为每一页生成1-3个随机框
            /*
            for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
                // 随机决定每页生成1-3个框
                const numBoxes = Math.floor(Math.random() * 3) + 1;
                // 获取当前页的尺寸信息
                const pageDimensions = this.pageDimensions[pageNum - 1];
                // 获取当前页的顶部偏移量
                const pageOffset = this.pageOffsets[pageNum - 1].top;

                for (let i = 0; i < numBoxes; i++) {
                    // 随机生成框的尺寸（像素）
                    // 宽度范围：50-200像素
                    const width = Math.floor(Math.random() * 150) + 50;
                    // 高度范围：30-100像素
                    const height = Math.floor(Math.random() * 70) + 30;

                    // 随机生成框的位置，确保在页面范围内
                    // x范围：0 到 (页面宽度 - 框宽度)
                    const x = Math.floor(Math.random() * (pageDimensions.width - width));
                    // y范围：0 到 (页面高度 - 框高度)
                    const y = Math.floor(Math.random() * (pageDimensions.height - height));

                    // 创建随机框对象
                    const newBox = {
                        id: this.boxId++,  // 框的唯一标识符
                        x,                  // 框的左边距（像素）
                        y: y + pageOffset,  // 框的顶部位置（像素）
                        width,              // 框的宽度（像素）
                        height,             // 框的高度（像素）
                        page: pageNum,      // 框所在的页码
                        pageOffset,         // 当前页面的顶部偏移量
                        relativeY: y,       // 相对于当前页面的顶部位置
                        // 将像素单位转换为毫米单位
                        xInMm: this.pixelToMm(x),        // 左边距（毫米）
                        yInMm: this.pixelToMm(y),        // 顶部边距（毫米）
                        widthInMm: this.pixelToMm(width), // 宽度（毫米）
                        heightInMm: this.pixelToMm(height) // 高度（毫米）
                    };

                    this.boxes.push(newBox);
                }
            }
            */
        },

        loadBoxes(boxesData) {
            // 清空现有的框
            this.boxes = [];
            
            // 遍历传入的框数据
            boxesData.forEach(boxData => {
                // 获取对应页面的信息
                const pageNum = boxData.page || 1;
                const pageOffset = this.pageOffsets[pageNum - 1]?.top || 0;
                const pageDimensions = this.pageDimensions[pageNum - 1];
                
                if (!pageDimensions) {
                    console.error(`Page ${pageNum} dimensions not found`);
                    return;
                }
                
                // 计算毫米到像素的转换比例
                const mmToPixel = pageDimensions.width / pageDimensions.widthInMm;
                
                // 将毫米单位转换为像素单位
                const x = Math.round((boxData.xInMm || 0) * mmToPixel);
                const y = Math.round((boxData.yInMm || 0) * mmToPixel);
                const width = Math.round((boxData.widthInMm || 0) * mmToPixel);
                const height = Math.round((boxData.heightInMm || 0) * mmToPixel);
                
                // 创建新的框对象
                const newBox = {
                    id: this.boxId++,
                    x,
                    y: y + pageOffset,
                    width,
                    height,
                    page: pageNum,
                    pageOffset,
                    relativeY: y,
                    xInMm: boxData.xInMm || 0,
                    yInMm: boxData.yInMm || 0,
                    widthInMm: boxData.widthInMm || 0,
                    heightInMm: boxData.heightInMm || 0
                };
                
                // 添加到框数组中
                this.boxes.push(newBox);
            });
            
            console.log('Loaded boxes:', this.boxes);
        }
    }
}); 