import {$div} from "../util/dom.js";
import Eventbus from "../util/eventbus.js";
import Input from "./input.js";
import {COMMAND, EVENT} from "../enum.js";
import Editor from "./editor.js";

var Cursor = function(){
    var me = {}
    var cursor;
    var cursorMark;
    let position = {x:0,y:0}
    let defaultCursor = "default";
    let currentCursor = undefined;
    let overrideCursor = undefined;
    
    me.init = function(){
        cursor = $div("cursor");
        cursorMark = $div("mark","",cursor);
        document.body.appendChild(cursor);

        document.body.addEventListener("pointermove", function (e) {
            position = {x:e.clientX,y:e.clientY};
            cursor.style.left =  e.clientX  + "px";
            cursor.style.top =  e.clientY  + "px";
        }, false);
        
        Eventbus.on(EVENT.drawColorChanged,(color)=>{
            cursorMark.style.borderColor = "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
         })
    }

    me.set = function(name){
        currentCursor = name;
        setCursor();
    }

    me.reset = function(){
        currentCursor = undefined;
        setCursor();
    }

    me.override = function(name){
        overrideCursor = name;
        setCursor();
    }

    me.resetOverride = function(name){
        overrideCursor = undefined;
        setCursor();
    }

    me.attach = function(name){
        cursor.style.display = "block";
        cursorMark.style.display = "block";
    }
    me.getPosition = ()=>{
        return position;
    }

    function setCursor(){
        document.body.classList.forEach((c)=>{
            if (c.startsWith("cursor-")) document.body.classList.remove(c);
        });
        let cursorName = overrideCursor || currentCursor || defaultCursor;
        document.body.classList.add("cursor-" + cursorName);
    }

    Eventbus.on(EVENT.modifierKeyChanged,()=>{
        if ((Input.isShiftDown() || Input.isAltDown()) && Editor.canPickColor()){
            me.override("colorpicker");
        }else{
            me.resetOverride();
        }

        if (Input.isSpaceDown()){
            me.override("pan");
        }
    })
    
    return me;
}();

export default Cursor;