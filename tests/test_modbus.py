from modbus import crc16


def test_crc16_read_holding_request():
    # 01 03 00 00 00 0A -> CRC bytes C5 CD (low byte first on the wire)
    frame = bytes.fromhex("01030000000A")
    crc = crc16(frame)
    assert bytes([crc & 0xFF, crc >> 8]) == bytes.fromhex("C5CD")


def test_crc16_check_value():
    # CRC-16/MODBUS check value for "123456789"
    assert crc16(b"123456789") == 0x4B37


def test_crc16_of_frame_with_crc_is_zero():
    # _recv_frame relies on this to detect the end of an RTU frame
    frame = bytes.fromhex("010300000001")
    crc = crc16(frame)
    assert crc16(frame + bytes([crc & 0xFF, crc >> 8])) == 0


def test_crc16_empty():
    assert crc16(b"") == 0xFFFF
