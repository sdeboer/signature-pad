/**
 * Usage for accepting signatures:
 *  $('.sigPad').signaturePad()
 *
 * Usage for displaying previous signatures:
 *  $('.sigPad').signaturePad({displayOnly:true}).regenerate(sig)
 *  or
 *  var api = $('.sigPad').signaturePad({displayOnly:true})
 *  api.regenerate(sig)
 */
(function ($) {

function SignaturePad (selector, options) {
  /**
   * Reference to the object for use in public methods
   *
   * @private
   *
   * @type {Object}
   */
  var self = this

  /**
   * Holds the merged default settings and user passed settings
   *
   * @private
   *
   * @type {Object}
   */
  , settings = $.extend({}, $.fn.signaturePad.defaults, options)

  /**
   * The current context, as passed by jQuery, of selected items
   *
   * @private
   *
   * @type {Object}
   */
  , context = $(selector)

  /**
   * jQuery reference to the canvas element inside the signature pad
   *
   * @private
   *
   * @type {Object}
   */
  , canvas = $(settings.canvas, context)

  /**
   * Dom reference to the canvas element inside the signature pad
   *
   * @private
   *
   * @type {Object}
   */
  , element = canvas.get(0)

  /**
   * The drawing context for the signature canvas
   *
   * @private
   *
   * @type {Object}
   */
  , canvasContext = null

  /**
   * Holds the previous point of drawing
   * Disallows drawing over the same location to make lines more delicate
   *
   * @private
   *
   * @type {Object}
   */
  , previous = {'x': null, 'y': null}

  /**
   * An array holding all the points and lines to generate the signature
   * Each item is an array containing the four elements:
   *   mx: moveTo x coordinate
   *   my: moveTo y coordinate
   *   lx: lineTo x coordinate
   *   lx: lineTo y coordinate
   *
   * @private
   *
   * @type {Array}
   */
  , output = []

  /**
   * Stores a timeout for when the mouse leaves the canvas
   * If the mouse has left the canvas for a specific amount of time
   * Stops drawing on the canvas
   *
   * @private
   *
   * @type {Object}
   */
  , mouseLeaveTimeout = false

    /**
     * Whether the mouse button is currently pressed down or not
     *
     * @private
     *
     * @type {Boolean}
     */
  , mouseButtonDown = false

  /**
   * Whether the browser is a touch event browser or not
   *
   * @private
   *
   * @type {Boolean}
   */
  , touchable = false

  /**
   * Whether events have already been bound to the canvas or not
   *
   * @private
   *
   * @type {Boolean}
   */
  , eventsBound = false

  /**
   * Remembers the default font-size when typing, and will allow it to be scaled for bigger/smaller names
   *
   * @private
   *
   * @type {Number}
   */
  , typeItDefaultFontSize = 30

  /**
   * Remembers the current font-size when typing
   *
   * @private
   *
   * @type {Number}
   */
  , typeItCurrentFontSize = typeItDefaultFontSize

  /**
   * Remembers how many characters are in the name field, to help with the scaling feature
   *
   * @private
   *
   * @type {Number}
   */
  , typeItNumChars = 0


  /**
   * Clears the mouseLeaveTimeout
   * Resets some other variables that may be active
   *
   * @private
   */
  function clearMouseLeaveTimeout () {
    clearTimeout(mouseLeaveTimeout)
    mouseLeaveTimeout = false
    mouseButtonDown = false
  }

  /**
   * Draws a line on canvas using the mouse position
   * Checks previous position to not draw over top of previous drawing
   *  (makes the line really thick and poorly anti-aliased)
   *
   * @private
   *
   * @param {Object} e The event object
   * @param {Number} newYOffset A pixel value for drawing the newY, used for drawing a single dot on click
   */
  function drawLine (e, newYOffset) {
    var offset, newX, newY

    e.preventDefault()

    offset = $(e.target).offset()

    clearTimeout(mouseLeaveTimeout)
    mouseLeaveTimeout = false

    if (typeof e.changedTouches !== 'undefined') {
      newX = Math.floor(e.changedTouches[0].pageX - offset.left)
      newY = Math.floor(e.changedTouches[0].pageY - offset.top)
    } else {
      newX = Math.floor(e.pageX - offset.left)
      newY = Math.floor(e.pageY - offset.top)
    }

    if (previous.x === newX && previous.y === newY)
      return true

    if (previous.x === null)
      previous.x = newX

    if (previous.y === null)
      previous.y = newY

    if (newYOffset)
      newY += newYOffset

    canvasContext.beginPath()
    canvasContext.moveTo(previous.x, previous.y)
    canvasContext.lineTo(newX, newY)
    canvasContext.lineCap = settings.penCap
    canvasContext.stroke()
    canvasContext.closePath()

    output.push({
        lx: newX
        , ly: newY
        , mx: previous.x
        , my: previous.y
    })

    previous.x = newX
    previous.y = newY

    if (settings.onDraw && typeof settings.onDraw === 'function')
      settings.onDraw.apply(self)
  }

  /**
   * Converts the data to a much more efficient form and saves the original width
   * and pen size of the canvas.  Changes the array of objects from
   * [{lx: x, ly: y, mx: m, my: n}, ...] into [x, y, m, n, ...].
   *
   * Then it prepends the pen width and canvas height.
   *
   * Then it converts each of those numbers into a charCode in a long string.
   *
   * NOTE:  All handlers of this string MUST BE utf-8 capable or this will
   * fail miserably.  Note that "cut-and-paste" of this string is pretty much
   * guaranteed to fail.
   */
  function compress () {
    var paths = '', path = ''

    for (path in output) {
      path = output[path]
      if (typeof path == 'object') {
        paths = paths
        + convertToCharacter(path.lx)
        + convertToCharacter(path.ly)
        + convertToCharacter(path.mx)
        + convertToCharacter(path.my)
      }
    }

		// If there are no paths then we don't want to have any value here
		if(paths) {
			paths = convertToCharacter(settings.penWidth) + convertToCharacter(element.width) + paths
		}

    return paths
  }

  /**
   * Undoes the compression algorithm for a "new" size canvas.
   * The assumption here is that if you are decompressing a string
   * you are then displaying a signature for evidentiary reasons
   * and the new canvas could be a different size from the original.
   * We'll scale the pen size as well, but not quite as fast as the canvas
   * as it looks funny then.
   */
  function decompress (src) {
    var paths = [], i, l = src.length
    , origHeight, origWidth, origPen
    , modifier
    , newPen

    origPen = convertFromCharacter(src, 0)

		// In case this isn't actually compressed content.
		// Since '[' is ascii 91 it should be safe to check since
		// our encoding starts from 'a' / 97
		if(origPen === '[') return src

    origWidth = convertFromCharacter(src, 1)

    modifier = element.width / origWidth
    if (!modifier) {
      throw "There is a problem with the height/width of the new canvas compared to the original."
      + " (ow: " + origWidth + ", nw: " + element.width + ")"
    }

    // Pen shouldn't scale quite as fast as the drawing
    newPen = origPen * ((0.8 * (modifier - 1) ) + 1 )

    if (newPen < 0.5) {
      throw "Too small a canvas for signature representation (op: " + origPen + ", np: " + newPen + ")"
    }
    newPen = Math.min( Math.round(newPen), 1)

    for (i = 2, l = src.length; i < l; i = i + 4) {
      paths.push({
          lx: convertFromCharacter(src, i, modifier)
          , ly: convertFromCharacter(src, i + 1, modifier)
          , mx: convertFromCharacter(src, i + 2, modifier)
          , my: convertFromCharacter(src, i + 3, modifier)
      })
    }
    return paths
  }

  function convertToCharacter(num) {
    return String.fromCharCode( parseInt(num.toString(), 10) + 91)
  }

  function convertFromCharacter(str, pos, modifier) {
    modifier = modifier || 1
    return Math.round( (str.charCodeAt(pos) - 91) * modifier )
  }

  /**
   * Callback registered to mouse/touch events of the canvas
   * Stops the drawing abilities
   *
   * @private
   *
   * @param {Object} e The event object
   */
  function stopDrawing (e) {
    if (!!e) {
      drawLine(e, 1)
    } else {
      if (touchable) {
        canvas.each(function () {
          this.removeEventListener('touchmove', drawLine)
        })
      } else {
        canvas.unbind('mousemove.signaturepad')
      }

      if (output.length > 0 && settings.onDrawEnd && typeof settings.onDrawEnd === 'function')
        settings.onDrawEnd.apply(self)
    }

    previous.x = null
    previous.y = null

    outputDrawing()
  }

  function outputDrawing() {
    var val, elem = settings.output && $(settings.output, context)
    if (elem && elem.length > 0) {
      if (settings.compress) {
        val = compress(output)
      } else {
        val = JSON.stringify(output)
      }
      elem.val(val)
    }
  }

  /**
   * Draws the signature line
   *
   * @private
   */
  function drawSigLine () {
    if (!settings.lineWidth)
      return false

    canvasContext.beginPath()
    canvasContext.lineWidth = settings.lineWidth
    canvasContext.strokeStyle = settings.lineColour
    canvasContext.moveTo(settings.lineMargin, settings.lineTop)
    canvasContext.lineTo(element.width - settings.lineMargin, settings.lineTop)
    canvasContext.stroke()
    canvasContext.closePath()
  }

  /**
   * Clears all drawings off the canvas and redraws the signature line
   *
   * @private
   */
  function clearCanvas () {
    canvasContext.clearRect(0, 0, element.width, element.height)
    canvasContext.fillStyle = settings.bgColour
    canvasContext.fillRect(0, 0, element.width, element.height)

    if (!settings.displayOnly)
      drawSigLine()

    canvasContext.lineWidth = settings.penWidth
    canvasContext.strokeStyle = settings.penColour

    $(settings.output, context).val('')
    output = []

    stopDrawing()
  }

  /**
   * Callback registered to mouse/touch events of the canvas
   * Draws a line at the mouse cursor location, starting a new line if necessary
   *
   * @private
   *
   * @param {Object} e The event object
   * @param {Object} o The object context registered to the event; canvas
   */
  function onMouseMove(e, o) {
    if (previous.x == null) {
      drawLine(e, 1)
    } else {
      drawLine(e, o)
    }
  }

  /**
   * Callback registered to mouse/touch events of canvas
   * Triggers the drawLine function
   *
   * @private
   *
   * @param {Object} e The event object
   * @param {Object} touchObject The object context registered to the event; canvas
   */
  function startDrawing (e, touchObject) {
    if (touchable) {
      touchObject.addEventListener('touchmove', onMouseMove, false)
    } else {
      canvas.bind('mousemove.signaturepad', onMouseMove)
    }

    // Draws a single point on initial mouse down, for people with periods in their name
    drawLine(e, 1)
  }

  /**
   * Removes all the mouse events from the canvas
   *
   * @private
   */
  function disableCanvas () {
    eventsBound = false

    canvas.each(function () {
      if (this.removeEventListener) {
        this.removeEventListener('touchend', stopDrawing)
        this.removeEventListener('touchcancel', stopDrawing)
        this.removeEventListener('touchmove', drawLine)
      }

      if (this.ontouchstart)
        this.ontouchstart = null;
    })

    $(document).unbind('mouseup.signaturepad')
    canvas.unbind('mousedown.signaturepad')
    canvas.unbind('mousemove.signaturepad')
    canvas.unbind('mouseleave.signaturepad')

    $(settings.clear, context).unbind('click.signaturepad')
  }

  /**
   * Lazy touch event detection
   * Uses the first press on the canvas to detect either touch or mouse reliably
   * Will then bind other events as needed
   *
   * @private
   *
   * @param {Object} e The event object
   */
  function initDrawEvents (e) {
    if (eventsBound)
      return false

    eventsBound = true

    // Closes open keyboards to free up space
    $('input').blur();

    if (typeof e.changedTouches !== 'undefined')
      touchable = true

    if (touchable) {
      canvas.each(function () {
        this.addEventListener('touchend', stopDrawing, false)
        this.addEventListener('touchcancel', stopDrawing, false)
      })

      canvas.unbind('mousedown.signaturepad')
    } else {
      $(document).bind('mouseup.signaturepad', function () {
        if (mouseButtonDown) {
          stopDrawing()
          clearMouseLeaveTimeout()
        }
      })
      canvas.bind('mouseleave.signaturepad', function (e) {
        if (mouseButtonDown) stopDrawing(e)

          if (mouseButtonDown && !mouseLeaveTimeout) {
            mouseLeaveTimeout = setTimeout(function () {
              stopDrawing()
              clearMouseLeaveTimeout()
            }, 500)
          }
      })

      canvas.each(function () {
        this.ontouchstart = null
      })
    }
  }

  /**
   * Triggers the abilities to draw on the canvas
   * Sets up mouse/touch events, hides and shows descriptions and sets current classes
   *
   * @private
   */
  function drawIt () {
    $(settings.typed, context).hide()
    clearCanvas()

    canvas.each(function () {
      this.ontouchstart = function (e) {
        e.preventDefault()
        mouseButtonDown = true
        initDrawEvents(e)
        startDrawing(e, this)
      }
    })

    canvas.bind('mousedown.signaturepad', function (e) {
      e.preventDefault()
      mouseButtonDown = true
      initDrawEvents(e)
      startDrawing(e)
    })

    $(settings.clear, context).bind('click.signaturepad', function (e) { e.preventDefault(); clearCanvas() })

    $(settings.typeIt, context).bind('click.signaturepad', function (e) { e.preventDefault(); typeIt() })
    $(settings.drawIt, context).unbind('click.signaturepad')
    $(settings.drawIt, context).bind('click.signaturepad', function (e) { e.preventDefault() })

    $(settings.typeIt, context).removeClass(settings.currentClass)
    $(settings.drawIt, context).addClass(settings.currentClass)
    $(settings.sig, context).addClass(settings.currentClass)

    $(settings.typeItDesc, context).hide()
    $(settings.drawItDesc, context).show()
    $(settings.clear, context).show()
  }

  /**
   * Triggers the abilities to type in the input for generating a signature
   * Sets up mouse events, hides and shows descriptions and sets current classes
   *
   * @private
   */
  function typeIt () {
    clearCanvas()
    disableCanvas()
    $(settings.typed, context).show()

    $(settings.drawIt, context).bind('click.signaturepad', function (e) { e.preventDefault(); drawIt() })
    $(settings.typeIt, context).unbind('click.signaturepad')
    $(settings.typeIt, context).bind('click.signaturepad', function (e) { e.preventDefault() })

    $(settings.output, context).val('')

    $(settings.drawIt, context).removeClass(settings.currentClass)
    $(settings.typeIt, context).addClass(settings.currentClass)
    $(settings.sig, context).removeClass(settings.currentClass)

    $(settings.drawItDesc, context).hide()
    $(settings.clear, context).hide()
    $(settings.typeItDesc, context).show()

    typeItCurrentFontSize = typeItDefaultFontSize = $(settings.typed, context).css('font-size').replace(/px/, '')
  }

  /**
   * Callback registered on key up and blur events for input field
   * Writes the text fields value as Html into an element
   *
   * @private
   *
   * @param {String} val The value of the input field
   */
  function type (val) {
    var typed = $(settings.typed, context)
    , cleanedVal = val.replace(/>/g, '&gt;').replace(/</g, '&lt;').trim()
    , oldLength = typeItNumChars
    , edgeOffset = typeItCurrentFontSize * 0.5

    typeItNumChars = cleanedVal.length
    typed.html(cleanedVal)

    if (!cleanedVal) {
      typed.css('font-size', typeItDefaultFontSize + 'px')
      return
    }

    if (typeItNumChars > oldLength && typed.outerWidth() > element.width) {
      while (typed.outerWidth() > element.width) {
        typeItCurrentFontSize--
        typed.css('font-size', typeItCurrentFontSize + 'px')
      }
    }

    if (typeItNumChars < oldLength && typed.outerWidth() + edgeOffset < element.width && typeItCurrentFontSize < typeItDefaultFontSize) {
      while (typed.outerWidth() + edgeOffset < element.width && typeItCurrentFontSize < typeItDefaultFontSize) {
        typeItCurrentFontSize++
          typed.css('font-size', typeItCurrentFontSize + 'px')
      }
    }
  }

  /**
   * Default onBeforeValidate function to clear errors
   *
   * @private
   *
   * @param {Object} context current context object
   * @param {Object} settings provided settings
   */
  function onBeforeValidate (context, settings) {
    $('p.' + settings.errorClass, context).remove()
    context.removeClass(settings.errorClass)
    $('input, label', context).removeClass(settings.errorClass)
  }

  /**
   * Default onFormError function to show errors
   *
   * @private
   *
   * @param {Object} errors object contains validation errors (e.g. nameInvalid=true)
   * @param {Object} context current context object
   * @param {Object} settings provided settings
   */
  function onFormError (errors, context, settings) {
    if (errors.nameInvalid) {
      context.prepend(['<p class="', settings.errorClass, '">', settings.errorMessage, '</p>'].join(''))
      $(settings.name, context).focus()
      $(settings.name, context).addClass(settings.errorClass)
      $('label[for=' + $(settings.name).attr('id') + ']', context).addClass(settings.errorClass)
    }

    if (errors.drawInvalid)
      context.prepend(['<p class="', settings.errorClass, '">', settings.errorMessageDraw, '</p>'].join(''))
  }

  /**
   * Validates the form to confirm a name was typed in the field
   * If drawOnly also confirms that the user drew a signature
   *
   * @private
   *
   * @return {Boolean}
   */
  function validateForm () {
    var valid = true
    , errors = {drawInvalid: false, nameInvalid: false}
    , onBeforeArguments = [context, settings]
    , onErrorArguments = [errors, context, settings]

    if (settings.onBeforeValidate && typeof settings.onBeforeValidate === 'function') {
      settings.onBeforeValidate.apply(self,onBeforeArguments)
    } else {
      onBeforeValidate.apply(self, onBeforeArguments)
    }

    if (settings.drawOnly && output.length < 1) {
      errors.drawInvalid = true
      valid = false
    }

    if ($(settings.name, context).val() === '') {
      errors.nameInvalid = true
      valid = false
    }

    if (settings.onFormError && typeof settings.onFormError === 'function') {
      settings.onFormError.apply(self,onErrorArguments)
    } else {
      onFormError.apply(self, onErrorArguments)
    }

		if(valid && settings.onFormSuccess && typeof settings.onFormSuccess === 'function') {
			settings.onFormSuccess.apply(self, onBeforeArguments);
		}

    return valid
  }

  /**
   * Redraws the signature on a specific canvas
   *
   * @private
   *
   * @param {Array} paths the signature JSON
   * @param {Object} context the canvas context to draw on
   * @param {Boolean} saveOutput whether to write the path to the output array or not
   */
  function drawSignature (paths, context, saveOutput) {
    var path, i
    for(i in paths) {
      path = paths[i]
      if (typeof path === 'object') {
        context.beginPath()
        context.moveTo(path.mx, path.my)
        context.lineTo(path.lx, path.ly)
        context.lineCap = settings.penCap
        context.stroke()
        context.closePath()

        if (saveOutput) output.push(path)
      }
    }
  }

  /**
   * Initialisation function, called immediately after all declarations
   * Technically public, but only should be used internally
   *
   * @private
   */
  function init () {
    // Fixes the jQuery.fn.offset() function for Mobile Safari Browsers i.e. iPod Touch, iPad and iPhone
    // https://gist.github.com/661844
    // http://bugs.jquery.com/ticket/6446
    if (parseFloat(((/CPU.+OS ([0-9_]{3}).*AppleWebkit.*Mobile/i.exec(navigator.userAgent)) || [0,'4_2'])[1].replace('_','.')) < 4.1) {
      $.fn.Oldoffset = $.fn.offset;
      $.fn.offset = function () {
        var result = $(this).Oldoffset()
        result.top -= window.scrollY
        result.left -= window.scrollX

        return result
      }
    }

    // Disable selection on the typed div and canvas
    $(settings.typed, context).bind('selectstart.signaturepad', function (e) { return $(e.target).is(':input') })
    canvas.bind('selectstart.signaturepad', function (e) { return $(e.target).is(':input') })

    if (!element.getContext && FlashCanvas)
      FlashCanvas.initElement(element)

    if (element.getContext) {
      canvasContext = element.getContext('2d')

      $(settings.sig, context).show()

      if (!settings.displayOnly) {
        if (!settings.drawOnly) {
          $(settings.name, context).bind('keyup.signaturepad', function () {
            type($(this).val())
          })

          $(settings.name, context).bind('blur.signaturepad', function () {
            type($(this).val())
          })

          $(settings.drawIt, context).bind('click.signaturepad', function (e) {
            e.preventDefault()
            drawIt()
          })
        }

        if (settings.drawOnly || settings.defaultAction === 'drawIt') {
          drawIt()
        } else {
          typeIt()
        }

        if (settings.validateFields) {
          if ($(selector).is('form')) {
            $(selector).bind('submit.signaturepad', function () { return validateForm() })
          } else {
            $(selector).parents('form').bind('submit.signaturepad', function () { return validateForm() })
          }
        }

        $(settings.sigNav, context).show()
      }
    }
  }

  $.extend(self, {
      /**
       * Initializes SignaturePad
       */
      init : function () { init() }

      /**
       * Allows options to be updated after initialization
       *
       * @param {Object} options An object containing the options to be changed
       */
      , updateOptions : function (options) {
        $.extend(settings, options)
      }

      /**
       * Regenerates a signature on the canvas using an array of objects
       * Follows same format as object property
       * @see var object
       *
       * @param {Array} paths An array of the lines and points
       */
      , regenerate : function (paths) {
        self.clearCanvas()
        $(settings.typed, context).hide()

        if (typeof paths === 'string') {
          if (settings.compress) {
            paths = decompress(paths)
          } else {
            paths = JSON.parse(paths)
          }
        }

        drawSignature(paths, canvasContext, true)

        outputDrawing()
        if (settings.output && $(settings.output, context).length > 0)
          $(settings.output, context).val(JSON.stringify(output))
      }

      /**
       * Clears the canvas
       * Redraws the background colour and the signature line
       */
      , clearCanvas : function () { clearCanvas() }

      /**
       * Returns the signature as a Js array
       *
       * @return {Array}
       */
      , getSignature : function () { return output }

      /**
       * Returns the signature as a Json string
       *
       * @return {String}
       */
      , getSignatureString : function () { return JSON.stringify(output) }

      /**
       * Returns the signature as an image
       * Re-draws the signature in a shadow canvas to create a clean version
       *
       * @return {String}
       */
      , getSignatureImage : function () {
        var tmpCanvas = document.createElement('canvas')
        , tmpContext = null
        , data = null

        tmpCanvas.style.position = 'absolute'
        tmpCanvas.style.top = '-999em'
        tmpCanvas.width = element.width
        tmpCanvas.height = element.height
        document.body.appendChild(tmpCanvas)

        if (!tmpCanvas.getContext && FlashCanvas)
          FlashCanvas.initElement(tmpCanvas)

        tmpContext = tmpCanvas.getContext('2d')

        tmpContext.fillStyle = settings.bgColour
        tmpContext.fillRect(0, 0, element.width, element.height)
        tmpContext.lineWidth = settings.penWidth
        tmpContext.strokeStyle = settings.penColour

        drawSignature(output, tmpContext)
        data = tmpCanvas.toDataURL.apply(tmpCanvas, arguments)

        document.body.removeChild(tmpCanvas)
        tmpCanvas = null

        return data
      }

      /**
       * The form validation function
       * Validates that the signature has been filled in properly
       * Allows it to be hooked into another validation function and called at a different time
       *
       * @return {Boolean}
       */
      , validateForm : function () { return validateForm() }
  })
  }

  /**
   * Create the plugin
   * Returns an Api which can be used to call specific methods
   *
   * @param {Object} options The options array
   *
   * @return {Object} The Api for controlling the instance
   */
  $.fn.signaturePad = function (options) {
    var api = null

    this.each(function () {
      if (!$.data(this, 'plugin-signaturePad')) {
        api = new SignaturePad(this, options)
        api.init()
        $.data(this, 'plugin-signaturePad', api)
      } else {
        api = $.data(this, 'plugin-signaturePad')
        api.updateOptions(options)
      }
    })

    return api
  }



  /**
   * Expose the defaults so they can be overwritten for multiple instances
   *
   * @type {Object}
   */
  $.fn.signaturePad.defaults = {
    defaultAction : 'typeIt' // What action should be highlighted first: typeIt or drawIt
    , displayOnly : false // Initialize canvas for signature display only; ignore buttons and inputs
    , drawOnly : false // Whether the to allow a typed signature or not
    , canvas : 'canvas' // Selector for selecting the canvas element
    , sig : '.sig' // Parts of the signature form that require Javascript (hidden by default)
    , sigNav : '.sigNav' // The TypeIt/DrawIt navigation (hidden by default)
    , bgColour : '#ffffff' // The colour fill for the background of the canvas; or transparent
    , penColour : '#145394' // Colour of the drawing ink
    , penWidth : 2 // Thickness of the pen
    , penCap : 'round' // Determines how the end points of each line are drawn (values: 'butt', 'round', 'square')
    , lineColour : '#ccc' // Colour of the signature line
    , lineWidth : 2 // Thickness of the signature line
    , lineMargin : 5 // Margin on right and left of signature line
    , lineTop : 35 // Distance to draw the line from the top
    , name : '.name' // The input field for typing a name
    , typed : '.typed' // The Html element to accept the printed name
    , clear : '.clearButton' // Button for clearing the canvas
    , typeIt : '.typeIt a' // Button to trigger name typing actions (current by default)
    , drawIt : '.drawIt a' // Button to trigger name drawing actions
    , typeItDesc : '.typeItDesc' // The description for TypeIt actions
    , drawItDesc : '.drawItDesc' // The description for DrawIt actions (hidden by default)
    , output : '.output' // The hidden input field for remembering line coordinates
    , currentClass : 'current' // The class used to mark items as being currently active
    , validateFields : true // Whether the name, draw fields should be validated
    , errorClass : 'error' // The class applied to the new error Html element
    , errorMessage : 'Please enter your name' // The error message displayed on invalid submission
    , errorMessageDraw : 'Please sign the document' // The error message displayed when drawOnly and no signature is drawn
    , onBeforeValidate : null // Pass a callback to be used instead of the built-in function
    , onFormError : null // Pass a callback to be used instead of the built-in function
    , onDraw : null // Pass a callback to be used to capture the drawing process
    , onDrawEnd : null // Pass a callback to be exectued after the drawing process
		, onFormSuccess : null // Pass a callback to be used when the signature is complete
    , compress : true // compress output using base62encode with '-' and ':' as separators
  }

}(jQuery))
