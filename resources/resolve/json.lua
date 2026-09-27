--[[
Minimal JSON encoder/decoder for Lua 5.1 / LuaJIT, used by the KathaCut Resolve bridge to speak the
mailbox protocol (docs/plans/resolve-textplus/README.md). No third-party code: this is small enough
to review directly rather than vendor a general-purpose JSON library.

Raw UTF-8 bytes pass through both encode and decode unchanged (Malayalam text is never touched at
the byte level); only `\"`, `\\`, ASCII control characters and `\uXXXX` (with surrogate pairs) are
escaped/unescaped.

Written for KathaCut, GPL-3.0-or-later.
]]

local json = {}

-- Sentinel for JSON null, since Lua has no way to store `nil` as a table value.
json.null = setmetatable({}, { __tostring = function() return "null" end })

-- A unique table key used to mark a table as "always encode as an array", so an empty array can be
-- told apart from an empty object (both are otherwise just `{}` in Lua).
local ARRAY_MARK = {}

function json.array(t)
  t = t or {}
  t[ARRAY_MARK] = true
  return t
end

local function isArray(t)
  if t[ARRAY_MARK] then return true end
  local maxKey, count = 0, 0
  for k in pairs(t) do
    if k ~= ARRAY_MARK then
      if type(k) ~= "number" or k < 1 or k ~= math.floor(k) then return false end
      if k > maxKey then maxKey = k end
      count = count + 1
    end
  end
  return count == maxKey and maxKey > 0
end

local ESCAPES = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t', ['\b'] = '\\b', ['\f'] = '\\f' }

local function encodeString(s)
  local out = { '"' }
  for i = 1, #s do
    local c = s:sub(i, i)
    local escaped = ESCAPES[c]
    if escaped then
      out[#out + 1] = escaped
    elseif s:byte(i) < 0x20 then
      out[#out + 1] = string.format("\\u%04x", s:byte(i))
    else
      out[#out + 1] = c
    end
  end
  out[#out + 1] = '"'
  return table.concat(out)
end

local encodeValue

local function encodeArray(t)
  local maxKey = 0
  for k in pairs(t) do
    if k ~= ARRAY_MARK and type(k) == "number" and k > maxKey then maxKey = k end
  end
  local parts = {}
  for i = 1, maxKey do
    parts[i] = encodeValue(t[i])
  end
  return "[" .. table.concat(parts, ",") .. "]"
end

local function encodeObject(t)
  local parts = {}
  for k, v in pairs(t) do
    if k ~= ARRAY_MARK then
      parts[#parts + 1] = encodeString(tostring(k)) .. ":" .. encodeValue(v)
    end
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

encodeValue = function(value)
  if value == nil or value == json.null then return "null" end
  local t = type(value)
  if t == "boolean" then return value and "true" or "false" end
  if t == "number" then
    if value ~= value or value == math.huge or value == -math.huge then return "null" end
    if math.floor(value) == value and math.abs(value) < 1e15 then return string.format("%d", value) end
    return tostring(value)
  end
  if t == "string" then return encodeString(value) end
  if t == "table" then
    if isArray(value) then return encodeArray(value) end
    return encodeObject(value)
  end
  error("json.encode: cannot encode a value of type " .. t)
end

function json.encode(value)
  return encodeValue(value)
end

local function utf8Encode(codepoint)
  if codepoint < 0x80 then
    return string.char(codepoint)
  elseif codepoint < 0x800 then
    return string.char(0xC0 + math.floor(codepoint / 0x40), 0x80 + (codepoint % 0x40))
  elseif codepoint < 0x10000 then
    return string.char(
      0xE0 + math.floor(codepoint / 0x1000),
      0x80 + (math.floor(codepoint / 0x40) % 0x40),
      0x80 + (codepoint % 0x40))
  else
    return string.char(
      0xF0 + math.floor(codepoint / 0x40000),
      0x80 + (math.floor(codepoint / 0x1000) % 0x40),
      0x80 + (math.floor(codepoint / 0x40) % 0x40),
      0x80 + (codepoint % 0x40))
  end
end

function json.decode(str)
  local pos, len = 1, #str

  local function fail(msg) error(string.format("json.decode: %s at position %d", msg, pos)) end

  local function skipWhitespace()
    while pos <= len do
      local b = str:byte(pos)
      if b == 32 or b == 9 or b == 10 or b == 13 then pos = pos + 1 else break end
    end
  end

  local function expect(ch)
    if str:sub(pos, pos) ~= ch then fail("expected '" .. ch .. "'") end
    pos = pos + 1
  end

  local parseValue

  local function parseString()
    expect('"')
    local out = {}
    while true do
      if pos > len then fail("unterminated string") end
      local c = str:sub(pos, pos)
      if c == '"' then
        pos = pos + 1
        break
      elseif c == '\\' then
        pos = pos + 1
        local esc = str:sub(pos, pos)
        if esc == '"' or esc == '\\' or esc == '/' then out[#out + 1] = esc; pos = pos + 1
        elseif esc == 'n' then out[#out + 1] = '\n'; pos = pos + 1
        elseif esc == 't' then out[#out + 1] = '\t'; pos = pos + 1
        elseif esc == 'r' then out[#out + 1] = '\r'; pos = pos + 1
        elseif esc == 'b' then out[#out + 1] = '\b'; pos = pos + 1
        elseif esc == 'f' then out[#out + 1] = '\f'; pos = pos + 1
        elseif esc == 'u' then
          local code = tonumber(str:sub(pos + 1, pos + 4), 16)
          if not code then fail("invalid \\u escape") end
          pos = pos + 5
          if code >= 0xD800 and code <= 0xDBFF and str:sub(pos, pos + 1) == '\\u' then
            local low = tonumber(str:sub(pos + 2, pos + 5), 16)
            if low and low >= 0xDC00 and low <= 0xDFFF then
              code = 0x10000 + (code - 0xD800) * 0x400 + (low - 0xDC00)
              pos = pos + 6
            end
          end
          out[#out + 1] = utf8Encode(code)
        else
          fail("invalid escape \\" .. esc)
        end
      else
        out[#out + 1] = c
        pos = pos + 1
      end
    end
    return table.concat(out)
  end

  local function parseNumber()
    local start = pos
    if str:sub(pos, pos) == '-' then pos = pos + 1 end
    while pos <= len and str:sub(pos, pos):match("%d") do pos = pos + 1 end
    if str:sub(pos, pos) == '.' then
      pos = pos + 1
      while pos <= len and str:sub(pos, pos):match("%d") do pos = pos + 1 end
    end
    if str:sub(pos, pos) == 'e' or str:sub(pos, pos) == 'E' then
      pos = pos + 1
      if str:sub(pos, pos) == '+' or str:sub(pos, pos) == '-' then pos = pos + 1 end
      while pos <= len and str:sub(pos, pos):match("%d") do pos = pos + 1 end
    end
    local num = tonumber(str:sub(start, pos - 1))
    if not num then fail("invalid number") end
    return num
  end

  local function parseArray()
    expect('[')
    local result = json.array({})
    skipWhitespace()
    if str:sub(pos, pos) == ']' then pos = pos + 1; return result end
    local i = 0
    while true do
      skipWhitespace()
      i = i + 1
      result[i] = parseValue()
      skipWhitespace()
      local c = str:sub(pos, pos)
      if c == ',' then pos = pos + 1
      elseif c == ']' then pos = pos + 1; break
      else fail("expected ',' or ']'") end
    end
    return result
  end

  local function parseObject()
    expect('{')
    local result = {}
    skipWhitespace()
    if str:sub(pos, pos) == '}' then pos = pos + 1; return result end
    while true do
      skipWhitespace()
      local key = parseString()
      skipWhitespace()
      expect(':')
      skipWhitespace()
      result[key] = parseValue()
      skipWhitespace()
      local c = str:sub(pos, pos)
      if c == ',' then pos = pos + 1
      elseif c == '}' then pos = pos + 1; break
      else fail("expected ',' or '}'") end
    end
    return result
  end

  parseValue = function()
    skipWhitespace()
    local c = str:sub(pos, pos)
    if c == '{' then return parseObject() end
    if c == '[' then return parseArray() end
    if c == '"' then return parseString() end
    if c == 't' then
      if str:sub(pos, pos + 3) == 'true' then pos = pos + 4; return true end
      fail("invalid literal")
    end
    if c == 'f' then
      if str:sub(pos, pos + 4) == 'false' then pos = pos + 5; return false end
      fail("invalid literal")
    end
    if c == 'n' then
      if str:sub(pos, pos + 3) == 'null' then pos = pos + 4; return json.null end
      fail("invalid literal")
    end
    if c == '-' or c:match("%d") then return parseNumber() end
    fail("unexpected character '" .. c .. "'")
  end

  skipWhitespace()
  local value = parseValue()
  skipWhitespace()
  return value
end

return json
