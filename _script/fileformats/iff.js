/*

	MIT License

	Copyright (c) 2019-2023 Steffest - dev@stef.be

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in all
	copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
	SOFTWARE.

 */


import BinaryStream from "../util/binarystream.js";
import ImageProcessing from "../util/imageProcessing.js";

var FILETYPE = {
    IFF: {name: "IFF file"},
    ILBM: {name: "ILBM Image", actions:["show"], inspect: true},
    ANIM: {name: "IFF ILBM Animation"}
}

var IFF = function(){
    // Detect and Decode IFF Files
    // handles ILBM images, including EHB (Extra Half-Bright) and HAM (Hold and Modify)
    // TODO: Brushes and other masked images

    // image format info on https://en.wikipedia.org/wiki/ILBM

    var me = {};

    me.fileTypes={
        IFF: {name: "IFF file"},
        ILBM: {name: "ILBM Image", actions:["show"], inspect: true},
        ANIM: {name: "IFF ILBM Animation"}
    };

    me.parse = function(file,decodeBody){
        var img = {
            palette: []
        };
        var index = 12;

        function readChunk(){
            var chunk = {};
            chunk.name = file.readString(4);
            chunk.size = file.readDWord();
            return chunk;
        }

        while (index<file.length-4){
            file.goto(index);
            var chunk = readChunk();
            index += chunk.size + 8;
            if (chunk.size%2 === 1) index++;

            switch (chunk.name){
                case "BMHD":
                    img.width = file.readWord();
                    img.height = file.readWord();
                    img.x = file.readShort();
                    img.y = file.readShort();
                    img.numPlanes = file.readUbyte();
                    img.mask = file.readUbyte();
                    img.compression = file.readUbyte();
                    img.pad = file.readUbyte();
                    img.transparentColor = file.readWord();
                    img.xAspect = file.readUbyte();
                    img.yAspect = file.readUbyte();
                    img.pageWidth = file.readWord();
                    img.pageHeight = file.readWord();
                    console.log(img.numPlanes + " planes");
                    if (img.numPlanes && img.numPlanes<9) img.colors = 1<<img.numPlanes;
                    if (img.numPlanes==24){
                        img.trueColor = true
                    }
                    break;
                case "CMAP":
                    for (var i = 0, max=chunk.size/3;i<max;i++){
                        img.palette.push([file.readUbyte(),file.readUbyte(),file.readUbyte()]);
                    }
                    break;
                case "CRNG":
                    img.colourRange = img.colourRange || [];
                    file.readShort(); // padding
                    img.colourRange.push({
                        rate: file.readShort(), // 16384 = 60 steps/second
                        flags: file.readShort(),
                        low: file.readUbyte(),
                        high: file.readUbyte()
                    });
                    break;
                case "DRNG":
                    // Dpaint IV enhanced color cycle chunk.
                    // https://wiki.amigaos.net/wiki/ILBM_IFF_Interleaved_Bitmap#ILBM.DRNG
                    img.colourRange = img.colourRange || [];
                    let range = {
                        min: file.readUbyte(),
                        max: file.readUbyte(),
                        rate: file.readShort(),
                        flags: file.readShort(),
                        numberOfDColors: file.readUbyte(),
                        colors:[],
                        numberOfDIndexes: file.readUbyte(),
                        indexes:[],
                    }
                    for (let i=0;i<range.numberOfDColors;i++){
                        // true color RGB values. (Is this used? I've never seen it in the wild)
                        range.colors.push({
                            index: file.readUbyte(),
                            red: file.readUbyte(),
                            green: file.readUbyte(),
                            blue: file.readUbyte()
                        });
                    }

                    for (let i=0;i<range.numberOfDIndexes;i++){
                        // index values
                        range.indexes.push({
                            index: file.readUbyte(),
                            colorIndex: file.readUbyte()
                        });
                    }
                    img.colourRange.push(range);
                    break;
                case "CCRT":
                    // Graphicraft Color Cycle chunk
                    // https://wiki.amigaos.net/wiki/ILBM_IFF_Interleaved_Bitmap#ILBM.CCRT
                    // examples: https://amiga.lychesis.net/applications/Graphicraft.html
                    img.colourRange = img.colourRange || [];
                    img.colourRange.push({
                        direction: file.readWord(),
                        low: file.readUbyte(),
                        high: file.readUbyte(),
                        seconds: file.readLong(),
                        microseconds: file.readLong(),
                        padding: file.readWord()
                    });
                    break;
                case "CAMG":
                    var v = file.readLong();
                    img.interlaced = v & 0x4;
                    img.ehb = v & 0x80;
                    img.ham = v & 0x800;
                    img.hires = v & 0x8000;
                    break;
                case "BODY":
                    img.body = [];

                    // adjust EHB and HAM palette here as the order of CMAP and CAMG is not defined;
                    if (img.ehb){
                        for (i = 0;i<32;i++){
                            var c = img.palette[i];
                            img.palette[i+32] = [c[0]>>1,c[1]>>1,c[2]>>1]
                        }
                    }
                    img.colorPlanes = img.numPlanes;
                    if (img.ham){
                        img.hamPixels = [];
                        img.colorPlanes = 6; // HAM8
                        if (img.numPlanes<7) img.colorPlanes = 4; // HAM6
                    }

                    // some images have bad CAMG blocks?
                    if (!img.hires && img.width>=640) img.hires=true;
                    if (img.hires && !img.interlaced && img.height>=400) img.interlaced=true;

                    if (decodeBody){
                        var pixels = [];
                        var lineWidth = (img.width + 15) >> 4; // in words
                        lineWidth = lineWidth*2; // in bytes

                        for (var y = 0; y<img.height; y++){
                            pixels[y] = [];
                            if (img.ham) img.hamPixels[y] = [];

                            for (var plane=0;plane<img.numPlanes;plane++){
                                var line = [];
                                if (img.compression) {
                                    // RLE compression
                                    while (line.length < lineWidth) {
                                        var b = file.readUbyte();
                                        if (b === 128) break;
                                        if (b > 128) {
                                            var b2 = file.readUbyte();
                                            for (var k = 0; k < 257 - b; k++) line.push(b2);
                                        } else {
                                            for (k = 0; k <= b; k++) line.push(file.readUbyte());
                                        }
                                    }
                                }else{
                                    for (var x = 0; x<lineWidth; x++) line.push(file.readUbyte());
                                }

                                // add bitplane line to pixel values;
                                for (b = 0; b<lineWidth; b++){
                                    var val = line[b];
                                    for (i = 7; i >= 0; i--) {
                                        x = (b*8) + (7-i);
                                        var bit = val & (1 << i) ? 1 : 0;
                                        if (plane<img.colorPlanes){
                                            var p = pixels[y][x] || 0;
                                            pixels[y][x] = p + (bit<<plane);
                                        }else{
                                            p=img.hamPixels[y][x] || 0;
                                            img.hamPixels[y][x] = p + (bit<<(plane-img.colorPlanes));
                                        }
                                    }
                                }
                            }
                        }
                        img.pixels = pixels;
                    }
                    break;
                default:
                    console.log("unhandled IFF chunk: " + chunk.name);
                    break;
            }
        }

        return img;
    };

    me.detect=function(file){
        var id = file.readString(4,0);
        if (id === "FORM"){
            var size = file.readDWord();
            if ((size + 8) <= file.length){
                // the size check isn't always exact for images?
                var format = file.readString(4);
                if (format === "ILBM"){return FILETYPE.ILBM;}
                if (format === "ANIM"){return FILETYPE.ANIM;}
                return FILETYPE.IFF;
            }
        }
    };

    me.inspect = function(file){
        var result = "";
        var info = me.parse(file,false);
        if (info.width && info.height) result=info.width+"x"+info.height;
        if (info.ham){
            result+= " HAM" + (info.numPlanes<7?"6":"8");
        } if (info.trueColor){
            result+= " 24-bit";
        }else{
            if (info.colors){
                result+= " " + info.colors + " colours";
            }else if(info.palette){
                result+= "palette with " + info.palette.length + " colours";
            }

        }
        return result;
    };

    me.handle = function(file,action){
        console.log(action);
        if (action === "show"){
            var img = me.parse(file,true);
            console.log(img);
            if (AdfViewer) AdfViewer.showImage(me.toCanvas(img));
        }
    };

    me.toCanvas = function(img){
        var canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        var pixelWidth = 1;
        //console.log(canvas.width,canvas.height);
        if (img.interlaced && !img.hires){
            canvas.width*=2;
            pixelWidth = 2;
        }
        //console.log(canvas.width,canvas.height);
        var ctx = canvas.getContext("2d");
        for (var y=0;y<img.height;y++){
            var prevColor = [0,0,0];
            for (var x=0;x<img.width;x++){
                var pixel = img.pixels[y][x];
                var color = img.palette[pixel] || [0,0,0];
                if(img.ham){
                    var modifier = img.hamPixels[y][x];
                    if (modifier){
                        pixel = pixel << (8-img.colorPlanes); // should the remaining (lower) bits also be filled?
                        color = prevColor.slice();
                        if (modifier === 1) color[3] = pixel;
                        if (modifier === 2) color[0] = pixel;
                        if (modifier === 3) color[1] = pixel;
                    }
                }
                if (img.trueColor){
                    //bits are stored like R0-R7,G0-B7,B0-B7
                    // when reading out we just stack them on top, that's why the BlUE values are in 0xff0000 and the RED values are in 0x0000ff
                    color = [pixel & 0x0000ff,(pixel & 0x00ff00) >> 8,(pixel & 0xff0000) >> 16];
                }
                prevColor = color;


                ctx.fillStyle = "rgba("+color[0]+","+color[1]+","+color[2]+",1)";
                ctx.fillRect(x*pixelWidth, y, pixelWidth, 1 );
            }
        }
        return canvas;
    };

    // creates an ArrayBuffer with the binary data of the Icon;
    me.write = function(canvas){

        let colors = ImageProcessing.getColors(canvas,256);
        let bitplaneCount = 1;
        while((1 << bitplaneCount) < colors.length) bitplaneCount++;
        while (colors.length < (1 << bitplaneCount)) colors.push([0,0,0]);

        var w = canvas.width;
        var h = canvas.height;
        var pixels = canvas.getContext("2d").getImageData(0,0,w,h).data;

        var bytesPerLine = Math.ceil(w/16) * 2;
        var bodySize = bytesPerLine * bitplaneCount * h;

        var fileSize = 40 + 8 + 8;
        fileSize += colors.length*3;
        fileSize += bodySize;
        if (fileSize&1) fileSize++;

        var file = BinaryStream(new ArrayBuffer(fileSize),true);

        file.goto(0);
        file.writeString("FORM");
        file.writeDWord(fileSize-8);

        file.writeString("ILBM");

        file.writeString("BMHD");
        file.writeDWord(20);
        file.writeWord(w);
        file.writeWord(h);
        file.writeWord(0);
        file.writeWord(0);
        file.writeUbyte(bitplaneCount);
        file.writeUbyte(0);
        file.writeUbyte(0);
        file.writeUbyte(0);
        file.writeWord(0);
        file.writeUbyte(1);
        file.writeUbyte(1);
        file.writeWord(w);
        file.writeWord(h);

        // palette
        file.writeString("CMAP");
        file.writeDWord(colors.length*3);
        colors.forEach(function(color){
            file.writeUbyte(color[0]);
            file.writeUbyte(color[1]);
            file.writeUbyte(color[2]);
        })

        // body
        file.writeString("BODY");
        file.writeDWord(bodySize);
        var bitplaneLines = [];

        function getIndex(color){
            let index = colors.findIndex((c)=>{return c[0] === color[0] && c[1] === color[1] && c[2] === color[2]});
            if (index<0){
                index = 0;
                console.error("color not found in palette",color);
            }
            return index;
        }

        for(var y=0; y<h; y++){
            for(var i = 0; i < bitplaneCount; i++) bitplaneLines[i] = new Uint8Array(bytesPerLine);
            for(var x=0; x<w; x++){
                var colorIndex = 0;
                var pixel = (x+y*w)*4;
                var color = [pixels[pixel],pixels[pixel+1],pixels[pixel+2]]

                var a = pixels[pixel+3]; // should we use an alpha threshold?

                colorIndex = getIndex(color);
                for(i = 0; i < bitplaneCount; i++){
                    if (colorIndex & (1 << i)) bitplaneLines[i][x >> 3] |= 0x80 >> (x & 7);
                }
            }
            for(i = 0; i < bitplaneCount; i++)
                for(var bi = 0; bi < bytesPerLine; bi++)
                    file.writeUbyte(bitplaneLines[i][bi]);
        }

        return file.buffer;
    }

    //if (FileType) FileType.register(me);

    return me;
}();

export default IFF;