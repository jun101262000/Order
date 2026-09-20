(function (root) {
    'use strict';
    const priceKey = value => {
        const n = Number(value);
        if (value === '' || value == null || !Number.isFinite(n) || n < 0) throw new Error('單價必須為非負數字');
        return String(Math.round(n * 100) / 100);
    };
    function inventoryRows(inventory) {
        return inventory.flatMap(p => {
            const main = priceKey(p.defPrice);
            const stocks = new Map([[main, Number(p.stock) || 0]]);
            Object.entries(p.extraStocks || {}).forEach(([price, qty]) => {
                const key = priceKey(price);
                // Legacy duplicate buckets represent separate physical quantities: do not discard either.
                stocks.set(key, (stocks.get(key) || 0) + (Number(qty) || 0));
            });
            return [...stocks].sort((a, b) => Number(a[0]) - Number(b[0])).map(([price, stock]) => ({id:p.id, name:p.name, price:Number(price), stock}));
        });
    }
    function deduct(inventory, items) {
        const result = inventory.map(p => ({...p, extraStocks:{...p.extraStocks}}));
        items.filter(i => i.type === '一般' || i.type === '另價').forEach(i => {
            const p = result.find(p => p.id === i.baseId);
            if (!p) throw new Error('找不到出貨商品');
            const price = priceKey(i.price);
            if (!Number.isInteger(i.qty) || i.qty <= 0) throw new Error('出貨數量不正確');
            // Select by price, never by the order-entry row type.
            if (price === priceKey(p.defPrice)) {
                p.stock = (Number(p.stock) || 0) + (Number(p.extraStocks[price]) || 0) - i.qty;
                delete p.extraStocks[price];
            } else p.extraStocks[price] = (Number(p.extraStocks[price]) || 0) - i.qty;
        });
        return result;
    }
    function reprice(p, newPrice) {
        const key=priceKey(newPrice), stocks={};
        inventoryRows([p]).forEach(row=>stocks[priceKey(row.price)]=row.stock);
        const stock=stocks[key] || 0; delete stocks[key];
        return {...p, defPrice:Number(key),stock,extraStocks:stocks};
    }
    const timeLabel = value => value && Number.isFinite(new Date(value).getTime())
        ? new Date(value).toLocaleString('zh-TW', {timeZone:'Asia/Taipei', hour12:false}) : '尚無可驗證的異動時間';
    function wrap(ctx, value, width) {
        const lines = [];
        String(value ?? '').split('\n').forEach(paragraph => {
            let line = '';
            for (const char of paragraph) {
                if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ''; }
                line += char;
            }
            lines.push(line);
        });
        return lines;
    }
    function makeCanvas(width, height) {
        const c = document.createElement('canvas'); c.width = width; c.height = height;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('此裝置無法產生圖片');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#000';
        ctx.textBaseline = 'top'; return [c, ctx];
    }
    function labelCanvas(order) {
        const [canvas, ctx] = makeCanvas(1200, 1800);
        const rows = order.summary.items.map((item, index, items) => ({
            ...item,
            displayName: index > 0 && item.baseId && item.baseId === items[index - 1].baseId &&
                (item.type === '一般' || item.type === '另價') &&
                (items[index - 1].type === '一般' || items[index - 1].type === '另價') ? '' :
                `${item.name}${item.type === '限定' ? '【限定】' : item.type === '分享' ? '【分享】' : ''}`
        }));
        function layout(size, draw) {
            let y = 58;
            const text = (value, bold = false, scale = 1, x = 58, width = 1084, align = 'left') => {
                ctx.font = `${bold ? 700 : 400} ${size * scale}px "Noto Sans TC", sans-serif`;
                ctx.textAlign = align;
                wrap(ctx, value, width).forEach(line => { if (draw) ctx.fillText(line, x, y); y += size * scale * 1.24; });
                ctx.textAlign = 'left';
            };
            const rule = (thick = 5) => { y += 10; if(draw) ctx.fillRect(58, y, 1084, thick); y += 18; };
            text('葳葳海鮮', true, 1.72, 600, 1084, 'center');
            text(`訂單日期：${order.timestampStr || ''}`, true, .72, 600, 1084, 'center');
            rule();
            text(order.orderer.isHandwritten ? '________________' : order.orderer.name, true, 1.25);
            if(order.orderer.phone) text(order.orderer.phone, true, .88);
            if(order.orderer.address) text(order.orderer.address, true, .78);
            text(order.paymentStatus === 'paid' ? '已付款' : order.paymentStatus === 'credit' ? `本次剩餘 $${order.creditAmount}` : '未付款', true, .82);
            rule(4);
            ctx.font = `700 ${size}px "Noto Sans TC", sans-serif`;
            if(draw) { ctx.fillText('品項',58,y); ctx.fillText('單價',720,y); ctx.fillText('量',900,y); ctx.fillText('小計',1010,y); }
            y += size * 1.35;
            rows.forEach(item => {
                ctx.font = `400 ${size}px "Noto Sans TC", sans-serif`;
                const nameLines = item.displayName ? wrap(ctx, item.displayName, 625) : [''];
                const cells = [wrap(ctx, String(item.price),150),wrap(ctx,String(item.qty),90),wrap(ctx,String(item.total),135)];
                if(draw) {
                    nameLines.forEach((line,i)=>ctx.fillText(line,58,y+i*size*1.22));
                    cells.forEach((lines,j)=>lines.forEach((line,i)=>ctx.fillText(line,[720,900,1010][j],y+i*size*1.22)));
                }
                y += Math.max(nameLines.length,...cells.map(x=>x.length))*size*1.22+18;
                if(draw) ctx.fillRect(58,y-5,1084,2);
            });
            rule(6);
            text(`小計                                      $${order.summary.subtotal}`, true, .88);
            text(`運費                                      +${order.summary.actualShip}`, true, .88);
            if(order.summary.actualDisc > 0) text(`折讓                                      -${order.summary.actualDisc}`, true, .88);
            rule(4);
            text('總額', true, 1.08);
            text(`$${order.summary.grandTotal}`, true, 1.75, 1142, 1084, 'right');
            rule(5);
            text('【匯款與聯絡資訊】', true, .88);
            text('郵局(700) 0191289-0858464', true, 1.08);
            text('吳庭葳  0910-745-919', true, 1.08);
            return y;
        }
        let size = 54;
        while(size >= 30 && layout(size, false) > 1742) size -= 1;
        if(size < 30) throw new Error('明細過多，無法在單張 10×15 公分標籤上清楚列印。請拆成多張訂單後輸出。');
        layout(size,true);
        const pixels = ctx.getImageData(0,0,1200,1800);
        for(let i=0;i<pixels.data.length;i+=4) {
            const bw = pixels.data[i] < 180 ? 0 : 255;
            pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=bw; pixels.data[i+3]=255;
        }
        ctx.putImageData(pixels,0,0);
        return canvas;
    }
    function colorOrderCanvas(order) {
        const rows=order.summary.items.map((item,index,items)=>({
            ...item,
            displayName:index>0 && item.baseId && item.baseId===items[index-1].baseId &&
                (item.type==='一般'||item.type==='另價') && (items[index-1].type==='一般'||items[index-1].type==='另價') ? '' :
                `${item.name}${item.type==='限定' ? '【限定】' : item.type==='分享' ? '【分享】' : ''}`
        }));
        const probe=makeCanvas(1200,1)[1]; probe.font='400 48px "Noto Sans TC", sans-serif';
        const rowHeights=rows.map(row=>Math.max(1,wrap(probe,row.displayName || '',590).length)*64+34);
        const height=Math.max(1650,850+rowHeights.reduce((sum,value)=>sum+value,0));
        if(height>6000) throw new Error('訂單明細過多，請拆成多張訂單後輸出圖片。');
        const [canvas,ctx]=makeCanvas(1200,height);
        ctx.fillStyle='#0f172a';ctx.fillRect(0,0,1200,240);
        ctx.fillStyle='#fff';ctx.font='900 78px "Noto Sans TC", sans-serif';ctx.fillText('葳葳海鮮',70,52);
        ctx.fillStyle='#94a3b8';ctx.font='700 30px "Noto Sans TC", sans-serif';ctx.fillText('ORDER CONFIRMATION',72,145);
        ctx.textAlign='right';ctx.fillText(order.timestampStr || '',1130,154);ctx.textAlign='left';
        let y=300;
        ctx.fillStyle='#64748b';ctx.font='700 28px "Noto Sans TC", sans-serif';ctx.textAlign='center';ctx.fillText('客戶資訊',600,y);y+=58;
        ctx.fillStyle='#000';ctx.font='900 62px "Noto Sans TC", sans-serif';ctx.fillText(order.orderer.isHandwritten?'________________':order.orderer.name,600,y);y+=88;
        ctx.font='700 35px "Noto Sans TC", sans-serif';
        if(order.orderer.phone){ctx.fillText(order.orderer.phone,600,y);y+=52;}
        if(order.orderer.address){wrap(ctx,order.orderer.address,1050).forEach(line=>{ctx.fillText(line,600,y);y+=48;});}
        ctx.textAlign='left';ctx.fillStyle='#cbd5e1';ctx.fillRect(70,y+12,1060,5);y+=60;
        ctx.fillStyle='#000';ctx.font='900 34px "Noto Sans TC", sans-serif';
        ctx.fillText('品項',70,y);ctx.fillText('單價',720,y);ctx.fillText('數量',900,y);ctx.fillText('小計',1030,y);y+=62;
        rows.forEach((row,index)=>{
            if(index%2){ctx.fillStyle='#f1f5f9';ctx.fillRect(60,y-14,1080,rowHeights[index]);}
            ctx.fillStyle='#000';ctx.font='400 46px "Noto Sans TC", sans-serif';
            wrap(ctx,row.displayName || '',590).forEach((line,lineIndex)=>ctx.fillText(line,70,y+lineIndex*60));
            ctx.fillText('$'+row.price,720,y);ctx.fillText('x'+row.qty,900,y);ctx.fillText('$'+row.total,1030,y);
            y+=rowHeights[index];
        });
        ctx.fillStyle='#cbd5e1';ctx.fillRect(70,y,1060,7);y+=48;
        const totalLine=(label,value,color='#000',size=38)=>{ctx.fillStyle=color;ctx.font=`900 ${size}px "Noto Sans TC", sans-serif`;ctx.fillText(label,700,y);ctx.textAlign='right';ctx.fillText(value,1130,y);ctx.textAlign='left';y+=size+28;};
        totalLine('商品總計','$'+order.summary.subtotal);
        totalLine('運費','+'+order.summary.actualShip);
        if(order.summary.actualDisc>0) totalLine('折讓','-'+order.summary.actualDisc,'#d97706');
        ctx.fillStyle='#cbd5e1';ctx.fillRect(700,y,430,4);y+=32;
        totalLine('總金額','$'+order.summary.grandTotal,'#dc2626',62);
        ctx.fillStyle='#334155';ctx.font='900 38px "Noto Sans TC", sans-serif';ctx.fillText('匯款與聯絡資訊',70,y-175);
        ctx.fillStyle='#0f172a';ctx.font='900 52px "Noto Sans TC", sans-serif';ctx.fillText('郵局(700) 0191289-0858464',70,y-118);ctx.fillText('吳庭葳  0910-745-919',70,y-52);
        return canvas;
    }
    function inventoryCanvas(rows, updatedAt, local) {
        const probe = makeCanvas(1100,1)[1]; probe.font='400 30px "Noto Sans TC", sans-serif';
        const heights = rows.map(r=>Math.max(1,wrap(probe,r.name,590).length)*42+24);
        const height = 200+heights.reduce((a,b)=>a+b,0);
        if(height > 30000) throw new Error('庫存表超出此裝置單張圖檔的安全尺寸，請改用電腦輸出。');
        const [canvas,ctx]=makeCanvas(1100,height);
        ctx.font='700 44px "Noto Sans TC", sans-serif'; ctx.fillText(local ? '庫存表（單機資料）' : '庫存表',40,30);
        ctx.font='400 26px "Noto Sans TC", sans-serif'; ctx.fillText('最後異動：'+timeLabel(updatedAt),40,95);
        ctx.fillText('商品',40,145); ctx.fillText('單價',700,145); ctx.fillText('庫存',920,145);
        let y=190;
        rows.forEach((r,index)=>{
            ctx.fillStyle='#000'; ctx.font='400 30px "Noto Sans TC", sans-serif';
            wrap(ctx,r.name,590).forEach((line,i)=>ctx.fillText(line,40,y+i*42));
            ctx.fillText('$'+r.price,700,y);
            ctx.fillStyle=r.stock<5?'#c00000':'#000'; ctx.font=`${r.stock<5?700:400} 32px "Noto Sans TC", sans-serif`;
            ctx.fillText(String(r.stock),920,y); y+=heights[index];
        });
        return canvas;
    }
    function crc32(bytes) {
        let crc=0xffffffff;
        for(const byte of bytes) { crc^=byte; for(let k=0;k<8;k++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
        return (crc^0xffffffff)>>>0;
    }
    function physicalPng(bytes) {
        // 1200 x 1800 pixels / 12000 pixels per metre = exactly 100 x 150 mm.
        const chunk=new Uint8Array(21), view=new DataView(chunk.buffer);
        view.setUint32(0,9); chunk.set([112,72,89,115],4);
        view.setUint32(8,12000); view.setUint32(12,12000); chunk[16]=1;
        view.setUint32(17,crc32(chunk.slice(4,17)));
        const parts=[bytes.slice(0,33),chunk]; let offset=33;
        while(offset<bytes.length) {
            const length=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0);
            const type=String.fromCharCode(...bytes.slice(offset+4,offset+8));
            if(type!=='pHYs') parts.push(bytes.slice(offset,offset+length+12));
            offset+=length+12;
        }
        return new Blob(parts,{type:'image/png'});
    }
    async function pngBlob(canvas, physical=false) {
        let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!blob) throw new Error('圖檔產生失敗，可能是裝置記憶體不足');
        if(physical) blob=physicalPng(new Uint8Array(await blob.arrayBuffer()));
        return blob;
    }
    function downloadBlob(blob, filename) {
        const url=URL.createObjectURL(blob), a=document.createElement('a');
        a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
        const revokeTimer=setTimeout(()=>URL.revokeObjectURL(url),60000);
        if(revokeTimer && typeof revokeTimer.unref==='function') revokeTimer.unref();
    }
    async function saveBlob(blob,filename,navigatorObject) {
        const nav=navigatorObject || (typeof navigator!=='undefined' ? navigator : null);
        if(nav && typeof nav.share==='function') {
            const file=new File([blob],filename,{type:'image/png'});
            if(typeof nav.canShare!=='function' || nav.canShare({files:[file]})) {
                try { await nav.share({files:[file],title:'葳葳海鮮圖片'}); return 'shared'; }
                catch(error) { if(error && error.name==='AbortError') return 'cancelled'; }
            }
        }
        downloadBlob(blob,filename); return 'downloaded';
    }
    async function download(canvas, filename, physical=false) {
        const blob=await pngBlob(canvas,physical);
        downloadBlob(blob,filename);
        return blob;
    }
    const api={priceKey,inventoryRows,deduct,reprice,timeLabel,wrap,labelCanvas,colorOrderCanvas,inventoryCanvas,physicalPng,pngBlob,downloadBlob,saveBlob,download};
    if(typeof module!=='undefined') module.exports=api; else root.OrderTools=api;
})(typeof window!=='undefined'?window:globalThis);
