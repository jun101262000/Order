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
        function layout(size, draw) {
            let y = 52;
            const text = (value, bold = false, scale = 1) => {
                ctx.font = `${bold ? 700 : 400} ${size * scale}px "Noto Sans TC", sans-serif`;
                wrap(ctx, value, 1096).forEach(line => { if (draw) ctx.fillText(line, 52, y); y += size * scale * 1.35; });
            };
            const rule = () => { y += 10; if(draw) ctx.fillRect(52, y, 1096, 2); y += 14; };
            text('葳葳海鮮　出貨單', true, 1.5);
            text(`單號：${order.id || ''}`);
            text(`客戶：${order.orderer.isHandwritten ? '________________' : order.orderer.name}` ,true);
            text(`電話：${order.orderer.phone || '________________'}`);
            text(`地址：${order.orderer.address || '________________'}`);
            text(order.paymentStatus === 'paid' ? '已付款' : order.paymentStatus === 'credit' ? `本次剩餘 $${order.creditAmount}` : '未付款');
            rule();
            ctx.font = `700 ${size}px "Noto Sans TC", sans-serif`;
            if(draw) { ctx.fillText('商品',52,y); ctx.fillText('單價',690,y); ctx.fillText('數量',850,y); ctx.fillText('小計',990,y); }
            y += size * 1.5;
            order.summary.items.forEach(item => {
                ctx.font = `400 ${size}px "Noto Sans TC", sans-serif`;
                const nameLines = wrap(ctx, item.name, 610);
                const cells = [wrap(ctx, '$'+item.price,140),wrap(ctx,item.qty,120),wrap(ctx,'$'+item.total,158)];
                if(draw) {
                    nameLines.forEach((line,i)=>ctx.fillText(line,52,y+i*size*1.35));
                    cells.forEach((lines,j)=>lines.forEach((line,i)=>ctx.fillText(line,[690,850,990][j],y+i*size*1.35)));
                }
                y += Math.max(nameLines.length,...cells.map(x=>x.length))*size*1.35+12;
            });
            rule();
            text(`商品總計：$${order.summary.subtotal}`);
            text(`運費：$${order.summary.actualShip}　折讓：$${order.summary.actualDisc}`);
            text(`總金額：$${order.summary.grandTotal}`,true,1.35);
            return y;
        }
        let size = 38;
        while(size >= 22 && layout(size, false) > 1748) size -= 1;
        if(size < 22) throw new Error('明細過多，無法在單張 10×15 公分標籤上清楚列印。請拆成多張訂單後輸出。');
        layout(size,true);
        const pixels = ctx.getImageData(0,0,1200,1800);
        for(let i=0;i<pixels.data.length;i+=4) {
            const bw = pixels.data[i] < 180 ? 0 : 255;
            pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=bw; pixels.data[i+3]=255;
        }
        ctx.putImageData(pixels,0,0);
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
    async function download(canvas, filename, physical=false) {
        let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!blob) throw new Error('圖檔產生失敗，可能是裝置記憶體不足');
        if(physical) blob=physicalPng(new Uint8Array(await blob.arrayBuffer()));
        const url=URL.createObjectURL(blob), a=document.createElement('a');
        a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),60000);
        return blob;
    }
    const api={priceKey,inventoryRows,deduct,reprice,timeLabel,wrap,labelCanvas,inventoryCanvas,physicalPng,download};
    if(typeof module!=='undefined') module.exports=api; else root.OrderTools=api;
})(typeof window!=='undefined'?window:globalThis);
