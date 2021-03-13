import * as Tone from "tone"
import Vex from "vexflow"

//version：21-03-13

function unsub_str(s,l,r){
	//从一个字符串抠出来一个子串
	return s.substr(0,l) + s.substr(r,s.length)
}

function ymusic_decode(content){
	// 消除转义符号
	var c = document.createElement("div");
	c.innerHTML = content
	return c.innerText
}


var ymusic_sampler = undefined

function ymusic_warning(str = ""){
	console.log("错误：" + str.toString())
}


function ymusic_get_default_str_key(){ 
	/*默认的吉他调弦*/
	return {
		1: ["E" , "4"] , 
		2: ["B" , "3"] , 
		3: ["G" , "3"] , 
		4: ["D" , "3"] , 
		5: ["A" , "2"] , 
		6: ["E" , "2"] , 
	}
}

function ymusic_pushkey(key , num){
	/*key形如：['A' , '5'] ，生成提高num半音的音*/

	let name2num = {
		"C":0,"C#":1,"Db":1,
		"D":2,"D#":3,"Eb":3,"E":4,"F":5,"F#":6,"Gb":6,
		"G":7,"G#":8,"Ab":8,"A":9,"A#":10,"Bb":10,"B":11,
	}
	let num2name = {}
	for(let x in name2num)
		num2name[ name2num[x] ] = x

	let num_semitone = name2num[key[0].trim()] + parseInt( key[1].trim() ) * 12 //原来的半音数
	num_semitone += num

	let newheight = parseInt(num_semitone / 12)
	let newname = num2name[num_semitone - 12 * newheight]

	return [newname , newheight]
}

function ymusic_play_music(bar_notes , bar_metas , speed){
	/*播放一段音乐

	参数：
		bar_notes：[notes,...]，一小节已经解析好的音乐
			notes: 一段解析好的音符描述
				格式：
				[ 
					{
						duration: 持续时间（几分音符）,
						keys： [key,...]
							对于五线谱，key是一个描述音高的字符串
							对于吉他谱，key是 {str：弦数, fret: 品数}
						modifiers: [modifier,...]
							modifier：额外描述符（目前只有和弦名）
					},
					...
				] ,
			注意bar_notes要分小节给出，否则无法正确确定临时升降号的作用范围
		bar_metas：解析好的每小节谱信息
	*/

	// 如果没有初始化sampler，自动return
	if(ymusic_sampler == undefined)
	{
		ymusic_warning("No sampler")
		return
	}

	let to_play = []

	for(let bar_idx in bar_notes){
	
		let notes = bar_notes[bar_idx]
		let metas = bar_metas[bar_idx]

		let accidentials = {} //维护当前时间哪些音要升降。比如 accidentials[["C","5"]] = "b"
						  //在小节开头这个数组会被自动重置

		for(let x of notes){
			let keys = [] // 每一个key：[名字，高度]

			if(metas.stave_type == "五线"){
				for(let key of x.keys){
					let name   = key.match(/[a-gA-G]/)[0]
					let height = key.match(/\d+/)[0]
					keys.push([name,height])
				}
			}
			if(metas.stave_type == "吉他"){

				if(metas.str_key == undefined){
					if(bar_idx == 0)
						metas.str_key = ymusic_get_default_str_key() //用默认调弦
					else
						metas.str_key = bar_metas[bar_idx-1].str_key //用上一个小节的调弦
				}

				for(let key of x.keys){
					let str  = parseInt(key.str)
					let fret = parseInt(key.fret)

					if(! (fret >= 0)) //不是个正常的音
						continue

					key = ymusic_pushkey(metas.str_key[str] , fret) //找到这个音
					keys.push(key) //加入列表
				}
			}


			for(let mod of x.modifiers){
				if(mod.type != "accidental") //不是临时升降号
					continue
				if(mod.value == "n")    //还原号
					accidentials[keys[mod.idx]] = undefined
				else 					//升降号
					accidentials[keys[mod.idx]] = mod.value
			}

			//把至今为止所有的升降号作用这个音符上
			for(let i in keys){
				let key = keys[i]
				let acc = accidentials[key] ? accidentials[key] : "" //这个位置的升降号
				keys[i] = key[0] + acc + key[1] //类似C#5
			}

			if(x.duration.match("r")){ //休止符
				keys = []
			}

			to_play.push({
				keys: keys,
				duration: 1.0 / parseInt(x.duration), //多少个全音符
			})
		}
	}

	let semibreve = speed //一个音符的时间

	for(let i = to_play.length-1;i >= 0;i--){
		if(to_play[i].keys.length <= 0){
			if(i > 0)
			{
				to_play[i-1].duration += to_play[i].duration
				to_play[i].duration = 0
			}
		}

	}

	const now = Tone.now()
	let time_cnt = 0
	for(let x of to_play){
		if(x.duration <= 0)
			continue
		let true_duration = Math.min(x.duration + 0.2 , x.duration * 2)  * semibreve//实际演奏的时长
		ymusic_sampler.triggerAttackRelease(x.keys , true_duration , now + time_cnt)
		time_cnt += x.duration * semibreve
	}

}

function ymusic_GetStaveClefType(clef){
	/*将输入的谱号，转化为谱类型+谱号类型

	参数: 
		clef 输入的谱号。
	返回值：
		[谱类型,谱号类型]
	*/

	let stave_type = undefined
	let clef_type  = undefined
	let str_key    = undefined //调弦

	if(clef == "高"){
		stave_type = "五线"
		clef_type  = "treble"
	}
	else if(clef == "低"){
		stave_type = "五线"
		clef_type  = "bass"	
	}
	else if (clef.startsWith("吉他")){
		stave_type = "吉他"
		clef_type  = "tab"

		let str_info = clef.match(/吉他([\s\S]*)/)[1].trim() //除了开头的吉他之外的部分
		if(str_info != ""){ // 没给出调弦信息则保留undefined
			str_info = str_info.match(/：([\s\S]*)/)[1].trim().split("、")//挑出冒号，剩下以顿号隔开
			str_key = {}
			for(let i in str_info){
				str_key[parseInt(i)+1] = str_info[i].trim().split("/") //从一弦开始。每个音形如A/5
			}
		}
	}
	else
	{
		ymusic_warning("不支持的谱号！")
		stave_type = "五线"
		clef_type  = "treble"
	}

	return [stave_type , clef_type , str_key]

}

function ymusic_AutoHeight(height , stave_type){
	/*根据输入的谱类型线数自动决定高度
	
	参数：
		height：输入的高度，仅当height='auto'时本函数会运作。
		stave_type：谱类型。
	返回：
		推荐的绘图高度

	*/
	if(height != "auto")
		return parseInt(height)

	if (stave_type == "五线")
		return 10

	if (stave_type == "吉他")
		return 15

	throw "哪里出错了吧..."
}

function ymusic_AutoTopBotspace(stave_type){
	/*根据谱的类型不同自动决策上下额外加多少条线
	
	参数：
		stave_type：谱类型。
	返回：
		推荐的上下加线数

	*/

	if (stave_type == "五线")
		return [2,2]

	if (stave_type == "吉他")
		return [1,1]

	throw "哪里出错了吧..."

}

function ymusic_parse_notes(note_info , metas){
	/*给定音符描述文本，生成结构化的描述

	参数：
		note_info：描述音符的文本
		metas：解析好的谱信息
	返回：
		[ 
			[ 
				{
					duration: 持续时间（几分音符）,
					keys： [key,...]
						对于五线谱，key是一个描述音高的字符串
						对于吉他谱，key是 {str：弦数, fret: 品数}
					modifiers: [modifier,...]
						modifier：额外描述符（目前只有和弦名）
				},
				...
			] ,
			[
				{
					duration: 持续时间（几分音符）,
					text： 注释文本,
					posi：注释文本的位置，第几行（以第一条线的上方为第0行）
				},
				...
			] 
		]

	*/
	let parsed_notes = []
	let parsed_texts = []

	let notes = note_info.trim()
	notes = notes.split("|")
	for(let note of notes){
		note = note.trim()

		// 获得长度
		let duration = note.match(/\[\s*?([\dr]*)\s*?\]/)
		if(duration == undefined) //找不到长度标志，说明这不是个音符（比如，空串）
			continue
		note = unsub_str(note , duration.index , duration.index + duration[0].length) // 扣出匹配项
		duration = duration[1]

		// 这个位置的音符
		let parsed_note_keys = [] // 对于五线谱是keys，对于吉他谱是positions

		// 这个位置的注释
		let parsed_text 	 = "" // 所有文本
		let parsed_text_pos = -1 

		// 这个位置的和弦描述
		let modifiers = []

		//解析所有提供的信息
		let keys = note.split("、")
		let note_cnt = 0 //当前是第几个音符
		for(let key of keys){
			key = key.trim()
			if(key == "") //key是空的
				continue
			key = key.split("：") //同一个音的多个描述用：隔开

			if(key[0].trim() == "和"){ 					//是一个和弦描述
				let chord = key[1]
				modifiers.push({type: "chord" , value: chord})
			}
			else if(key[0].trim() == "文"){ 				//是一个文本
				let text = key[1]
				parsed_text += text

				if(key.length > 2){
					posi = parseInt(key[2])
					parsed_text_pos = posi //覆盖之前的，所有文本只能有一个高度
				}
			}
			else{										//是一个正常音符
				if(metas.stave_type == "五线"){ 	//五线谱音符
					if(key[0].match("/") == undefined) //五线谱音符一定有/隔开，找不到说明不是五线谱音符
						continue

					parsed_note_keys.push(key[0])

					if(key.length > 1){
						modifiers.push({type: "accidental" , value: key[1].trim() , idx: note_cnt})
					}

				}
				if(metas.stave_type == "吉他"){ 	//吉他音符
					if(key[0].match("-") == undefined) //吉他音符一定有-隔开，找不到说明不是五线谱音符
						continue	

					key = key[0].trim().split("-")
					let str  = parseInt(key[0].trim())  // 弦数
					let fret = key[1].trim() 			// 品数

					//如果品数是以数字开头的，就将其解释为数字
					if(fret.length > 0 && fret[0].match(/\d/) != undefined)
						fret = parseInt(fret)

					if(!(str == str)) //str是NaN
					{
						ymusic_warning("有一个品数不是数字：" + key[0])
						str = 5
						fret = "BUG"
					}

					parsed_note_keys.push({str:str , fret:fret})
				}
			}
			note_cnt += 1
		}

		parsed_notes.push({duration: duration , keys: parsed_note_keys , modifiers: modifiers})
		parsed_texts.push({duration: duration , text: parsed_text , posi: parsed_text_pos})
	}

	return [ parsed_notes , parsed_texts ]
}


function ymusic_parse_meta(meta_info , width , width_off , height){
	/*给定谱信息字符串，解析生成结构化的元信息描述

	参数：
		meta_info：谱信息字符串
		width：小节宽度
		width_off：小节固定宽度
	返回：
		一个列表，描述各种谱相关的信息
	*/
	// 获取元信息
	meta_info 	= meta_info.trim().split("，")
	let clef 	   	= meta_info[0].trim() //谱号
	let beat_value 	= parseInt( meta_info[2].trim() ) //时值
	let beat_num   	= parseInt( meta_info[3].trim() ) //拍数
													  // 类型
	let [stave_type , clef_type , str_key] = ymusic_GetStaveClefType(clef)
													  //线数
	let num_lines = meta_info[1].trim()
	let [extra_topspace , extra_botspace] = ymusic_AutoTopBotspace(stave_type)
	extra_botspace -= 1 //好像Vexflow默认会在下面加一个，去掉之
	while(num_lines.endsWith("+") || num_lines.endsWith("-")){// 检查末尾有多少个加减号
		if(num_lines.endsWith("+")) //加号增加下方行数
			extra_botspace += 1
		if(num_lines.endsWith("-")) //减号增加上方行数
			extra_topspace += 1
		num_lines = num_lines.substr(0,num_lines.length-1) //去掉这个加减号
	}
	num_lines = parseInt(num_lines) //把去掉加减号之后的部分转成数字

	//计算宽高
	width  = width_off + width * (beat_num / beat_value)
	height = ymusic_AutoHeight(height , stave_type) * (num_lines + extra_botspace + extra_topspace)


	return {
		"stave_type" : stave_type ,
		"clef_type"  : clef_type , 
		"num_lines"  : num_lines , 

		"beat_value" : beat_value ,
		"beat_num"   : beat_num ,  

		"topspace"   : extra_topspace , 
		"botspace"   : extra_botspace , 
		"height"     : height , 
		"width"    	 : width , 
		"str_key" 	 : str_key , 
	}
}

function ymusic_draw_music_onebar(ctx , meta_info, note_info, offset_w , offset_h , last_meta){
	/*给定各种解析好的信息，绘制一个小节的乐谱

	参数：
		ctx：绘图上下文
		meta_info：当前小节的谱信息
		note_info：当前小节的音符信息
		offset：绘图的x坐标偏移
		last_meta：上一个小节的谱信息（用来确定是否需要重新绘制谱号等）
	*/
	let VF = Vex.Flow

	// ---------- 画谱 ----------
	let meta = meta_info

	// 创建stave
	let stave = undefined
	if(meta.stave_type == "五线"){
		stave = new VF.Stave(offset_w , offset_h, meta.width, {num_lines : meta.num_lines})

		if(meta.clef_type != last_meta.clef_type || meta.flags["换行"]) //跟前一个人不一样才绘制
			stave.addClef(meta.clef_type)
		if(meta.beat_num != last_meta.beat_num || meta.beat_value != last_meta.beat_value || meta.flags["换行"])
			stave.addTimeSignature(meta.beat_num + "/" + meta.beat_value)
	}
	if (meta.stave_type == "吉他"){
		stave = new VF.TabStave(offset_w , offset_h, meta.width, {num_lines : meta.num_lines})
		if(meta.clef_type != last_meta.clef_type || meta.flags["换行"]) //跟前一个人不一样才绘制
			stave.addClef(meta.clef_type)
	}
	stave.options.space_above_staff_ln = meta.topspace //上方预留的空间
	stave.options.space_below_staff_ln = meta.botspace // 下方预留的空间
	stave.setContext(ctx).draw()

	// ---------- 画音符 ----------

	let [ parsed_notes , parsed_texts ] = note_info

	//音符
	let notes_to_render = []
	for(let nt of parsed_notes){ //取出所有解析出的音符信息，转成VF音符
		let the_note = undefined

		if(meta.stave_type == "五线"){
			the_note = new VF.StaveNote({
				clef 	: meta.clef_type, 
				keys 	: nt.keys, 
				duration: nt.duration,
			})
		}
		if(meta.stave_type == "吉他"){
			the_note = new VF.TabNote({
				positions 	: nt.keys, 
				duration 	: nt.duration,
			})
		}

		for(let mod of nt.modifiers){
			if(mod.type == "chord")
			{
				let chord = new VF.ChordSymbol().addGlyphOrText(mod.value)

				//这个库有点智障
				if(meta.stave_type == "五线")
					the_note.addModifier(0,chord)
				if(meta.stave_type == "吉他")
					the_note.addModifier(chord,0)
			}
			if(mod.type == "accidental")
			{
				let acc = new VF.Accidental(mod.value)
				the_note.addAccidental(mod.idx , acc)
			}
 
		}

		notes_to_render.push(the_note)
	}

	//注释文本
	let texts_to_render = []
	for(let nt of parsed_texts){ //取出所有文本信息，转成TextNote

		texts_to_render.push(
			new VF.TextNote({
				font: {
					family: "Arial",
					size: 12,
					weight: ""
				},
				text 	: nt.text + " ", 
				duration: nt.duration,
			})
			.setLine(nt.posi+3) // 为了让第一根线上方的空白刚好是0
			.setStave(stave)
			.setJustification(Vex.Flow.TextNote.Justification.LEFT)
		)		
	}

	if(meta_info.stave_type == "五线")
		var beams = VF.Beam.generateBeams(notes_to_render)
	VF.Formatter.FormatAndDraw(ctx, stave, notes_to_render)
	VF.Formatter.FormatAndDraw(ctx, stave, texts_to_render)
	if(meta_info.stave_type == "五线")
		beams.forEach(function(b) {b.setContext(ctx).draw()})
}

function ymusic_parse(innertext , width , width_off , height){
	/*给定用户字符串，解析生成结构化的信息
	
	返回值：
		[[第i小节的谱信息,...] , [第i小节的音符信息,...]]
	*/
	//提取所有小节信息
	let meta_infos = []
	let note_infos = []
	let flags_list = [] //特殊记号
	while(innertext.length > 0){
		let flags = {
			"换行": false
		}
		if (innertext.startsWith("换行")){
			flags["换行"] = true //注意这里是在对应小节前面（而不是后面）换行
		}
		flags_list.push(flags)

		let matched = innertext.match(/【([\S\s]*?)】\s*?【([\S\s]*?)】/) //忽视中间无法匹配的东西
		if(matched == undefined) //找不到了
			break

		meta_infos.push(matched[1])// 乐谱信息部分
		note_infos.push(matched[2])// 音符信息部分

		// assert matched.index == 0
		innertext = innertext.substr(matched.index + matched[0].length , innertext.length) //删去匹配部分
		innertext = innertext.trim()
	}

	//解析所有信息
	for(let i in meta_infos){
		meta_infos[i] = ymusic_parse_meta (meta_infos[i] , width , width_off , height) 
		note_infos[i] = ymusic_parse_notes(note_infos[i] , meta_infos[i])

		meta_infos[i].flags = flags_list[i] //额外添加特殊标记信息
	}

	return [meta_infos , note_infos]
}

function ymusic_draw(meta_infos , note_infos , fillcolor , backfillcolor){
	/*给定解析好的所有信息，绘制乐谱

	参数：
		meta_infos：所有解析好的谱信息
		note_infos：所有解析好的音符信息
		fillcolor：画图颜色
		backfillcolor：音符背后的颜色（用来防止谱线遮挡音符），不需要的话可以直接设为透明
	*/
	let VF = Vex.Flow

	//初始化绘图环境
	let render_container = document.createElement("span") //在这个新建的span内画图
	let renderer = new VF.Renderer(render_container, VF.Renderer.Backends.SVG)
	let ctx = renderer.getContext()
	ctx.setFillStyle(fillcolor).setStrokeStyle(fillcolor)
	ctx.setBackgroundFillStyle(backfillcolor)
	
	//算出总高度、总宽度
	let height = 0
	let now_height = 0
	let now_width  = 0
	let width  = 0
	for(let meta of meta_infos){
		if(meta.flags["换行"])
		{
			height += now_height
			width  = Math.max(width , now_width)
			now_height = 0
			now_width = 0
		}
		now_height = Math.max(now_height , meta.height)
		now_width  += meta.width
	}
	height += now_height // 如果最后没换行，则要加一次，如果换行了，则反之是0
	width  = Math.max(width , now_width)
	renderer.resize(width , height) //必须在创建stave之前resize

	let offset_w = 0
	let offset_h = 0
	for(let i in meta_infos){
		let meta_info = meta_infos[i]
		let note_info = note_infos[i]

		let last_meta = {}
		if(i > 0)
			last_meta = meta_infos[i-1]

		if(meta_info.flags["换行"]){
			offset_h += meta_info.height
			offset_w = 0
		}

		ymusic_draw_music_onebar(ctx , meta_info , note_info , offset_w , offset_h , last_meta)
		offset_w += meta_info.width
	}
	return render_container
}

let ymusic_counter = 0
function ymusic_draw_music(content , config){
	/*解析指定元素的内容，并创建元素

	参数：
		content：匹配的描述乐谱信息的内容
		config：用户配置
			width        ：小节宽度
			width_off    ：小节固定宽度
			height       ：每行高度，如果为"auto"则自动设置
			fillcolor    ：画图颜色
			backfillcolor：音符背后的颜色（用来防止谱线遮挡音符），不需要的话可以直接设为透明
			speed 		 ：每个全音符播放多长时间（秒数）
	*/
	let c = config

	let [meta_infos , note_infos] = ymusic_parse(content.trim() , c.width , c.width_off , c.height)
	let render_container 		  = ymusic_draw(meta_infos , note_infos , c.fillcolor , c.backfillcolor)

	//提取出音符
	let music_notes = []
	for(let [mnotes , tnotes] of note_infos){
		music_notes.push(mnotes)
	}

	//创建元素
	let element = document.createElement("span")
	let special_class = "ymusic_" + ymusic_counter //给每个人一个专门的class
	ymusic_counter ++
	
	element.innerHTML = `<span class = "ymusic ${special_class}">${render_container.innerHTML}</span>`

	//创建播放音乐的按钮
	let play = [music_notes , meta_infos , c.speed]

	return [element , special_class , play]
}

function autoconfig(c){
	c.width_off 	= c.width_off 		? parseInt(c.width_off) : 30
	c.width 		= c.width 			? parseInt(c.width) 	: 280
	c.height 		= c.height 			? parseInt(c.height) 	: "auto"
	c.fillcolor 	= c.fillcolor 		? c.fillcolor 		 	: "#000000" //默认黑色
	c.backfillcolor = c.backfillcolor   ? c.backfillcolor 	 	: "#00000000" //默认透明
	c.speed   		= c.speed 			? parseInt(c.speed)    	: 2.0
	return c
}

function m_start_ymusic(element , config , target_tags , flag){
	/*
	参数：
		flag：这一个元素是不是目标元素
	*/

	if(target_tags.includes(element.tagName))
		flag = true

	if(flag && element.innerHTML != undefined){
		let innerhtml = element.innerHTML

		let classes = []
		let play_infos = []

		for(let i = 0;i < 100;i++){

			let matched = innerhtml.match(/【乐谱开始】([\s\S]*?)【乐谱结束】/) //匹配一项
			if(matched == undefined)
				break

			let content = matched[1]
			content = ymusic_decode(content) //消除诸如&nasp;之类的符号

			let now_config = config
			let further_conf = content.match(/\{[\s\S]*?\}/) //匹配一段json格式数据
			if(further_conf != undefined){
				try{
					further_conf = JSON.parse(further_conf[0])
				}
				catch(e){
					ymusic_warning(e.toString())
					further_conf = {}
				}
				now_config = Object.assign({} , config , further_conf)
			}
			
			// 获得新建元素、新建元素的专门class，和播放信息，以便事后正确地创建元素
			let [new_ele , new_ele_class , new_ele_play] = ymusic_draw_music(content , now_config)

			//将新建元素添加替换匹配到的东西的位置
			innerhtml = innerhtml.substr(0 , matched.index) + 
						new_ele.innerHTML + 
						innerhtml.substr(matched.index + matched[0].length , innerhtml.length) 

			//记录class和播放使用的信息，事后使用
			classes   .push(new_ele_class)
			play_infos.push(new_ele_play)
		}
		//替换html代码
		element.innerHTML = innerhtml

		//给每个新建的对象添加onclick函数
		for(let i in classes){
			let ele = document.getElementsByClassName(classes[i])
			if(ele.length != 1)
				throw "有点不对..."
			let p = play_infos[i]
			ele[0].onclick = function(){ ymusic_play_music(p[0] , p[1] , p[2]) }
		}
	}

	for(let x of element.children)
		m_start_ymusic(x , config , target_tags , flag)
}

export function init_ymusic_sampler(files , baseurl){
	ymusic_sampler = new Tone.Sampler({
		urls: files,
		baseUrl: baseurl,
	}).toDestination()
}

export function start_ymusic(config = {}, target_tags = ["P"]){

	config = autoconfig(config)
	m_start_ymusic(document , config , target_tags , false)
}
