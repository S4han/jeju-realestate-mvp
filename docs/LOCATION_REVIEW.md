# 좌표 검토 대상 목록 (TASK-003, 2026-10-24)

지도 마커를 만들지 않는 단지 목록(`location_status` = REVIEW 61건, NONE 2건). 데이터: 한국부동산원 단지 식별정보(기준 2026-09-01) + 연속지적도 `AL_D002_50_20261008`.
REVIEW 단지는 대표 필지 중심점 좌표가 있으며, 링크로 위치를 확인할 수 있다. 검토 결과를 반영하는 방식(수동 확정 테이블)은 아직 구현하지 않았다.

| 단지명 | 지번주소 | 세대수 | 필지면적㎡ | 사유 | 위치 |
|---|---|---|---|---|---|
| 오션월드 | 제주특별자치도 제주시 화북일동 1937-1 | 120 |  | PARCEL_NOT_FOUND | - |
| SJ해피드림 | 제주특별자치도 제주시 화북일동 1794 | 14 |  | PARCEL_NOT_FOUND | - |
| 청목더웰연동 | 제주특별자치도 제주시 연동 276-3 | 220 | 651.4 | PARCEL_SMALL_FOR_UNITS | [지도](https://map.kakao.com/link/map/%EC%B2%AD%EB%AA%A9%EB%8D%94%EC%9B%B0%EC%97%B0%EB%8F%99,33.4834543,126.4903856) |
| 제주연동리슈빌디에스 | 제주특별자치도 제주시 연동 273-43 | 158 | 345.4 | PARCEL_SMALL_FOR_UNITS | [지도](https://map.kakao.com/link/map/%EC%A0%9C%EC%A3%BC%EC%97%B0%EB%8F%99%EB%A6%AC%EC%8A%88%EB%B9%8C%EB%94%94%EC%97%90%EC%8A%A4,33.4862582,126.4915402) |
| 제주연동중흥S-클래스 | 제주특별자치도 제주시 연동 306 | 151 | 596.0 | PARCEL_SMALL_FOR_UNITS | [지도](https://map.kakao.com/link/map/%EC%A0%9C%EC%A3%BC%EC%97%B0%EB%8F%99%EC%A4%91%ED%9D%A5S-%ED%81%B4%EB%9E%98%EC%8A%A4,33.4835077,126.4956855) |
| 블루파크시티 | 제주특별자치도 제주시 도두일동 2614 | 148 | 989.6 | PARCEL_SMALL_FOR_UNITS | [지도](https://map.kakao.com/link/map/%EB%B8%94%EB%A3%A8%ED%8C%8C%ED%81%AC%EC%8B%9C%ED%8B%B0,33.5060451,126.4640237) |
| 미도스카이빌 | 제주특별자치도 제주시 연동 284-5 | 120 | 391.5 | PARCEL_SMALL_FOR_UNITS | [지도](https://map.kakao.com/link/map/%EB%AF%B8%EB%8F%84%EC%8A%A4%EC%B9%B4%EC%9D%B4%EB%B9%8C,33.4856002,126.4928218) |
| 세기에코빌 | 제주특별자치도 제주시 이도이동 1018 | 99 | 200.2 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%84%B8%EA%B8%B0%EC%97%90%EC%BD%94%EB%B9%8C,33.4958135,126.5322804) |
| 동명 | 제주특별자치도 서귀포시 성산읍 고성리 1132-21 | 85 | 3922.6 | NON_RESIDENTIAL_JIMOK | [지도](https://map.kakao.com/link/map/%EB%8F%99%EB%AA%85,33.4497164,126.9135753) |
| 도령해든빌 | 제주특별자치도 제주시 연동 2332-17 | 63 | 228.7 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%8F%84%EB%A0%B9%ED%95%B4%EB%93%A0%EB%B9%8C,33.4929847,126.4904625) |
| 함덕해밀타운아파트 | 제주특별자치도 제주시 조천읍 함덕리 3052-1 | 56 | 224.8 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%ED%95%A8%EB%8D%95%ED%95%B4%EB%B0%80%ED%83%80%EC%9A%B4%EC%95%84%ED%8C%8C%ED%8A%B8,33.5436292,126.6594758) |
| 이호엘리시아아파트 | 제주특별자치도 제주시 이호이동 113-2 | 48 | 1922.8 | NON_RESIDENTIAL_JIMOK | [지도](https://map.kakao.com/link/map/%EC%9D%B4%ED%98%B8%EC%97%98%EB%A6%AC%EC%8B%9C%EC%95%84%EC%95%84%ED%8C%8C%ED%8A%B8,33.4938335,126.4630225) |
| 경진아트빌 | 제주특별자치도 제주시 노형동 920-12 | 47 | 288.5 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EA%B2%BD%EC%A7%84%EC%95%84%ED%8A%B8%EB%B9%8C,33.4831609,126.4814085) |
| 이레빌 | 제주특별자치도 제주시 연동 290-4 | 47 | 225.1 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%9D%B4%EB%A0%88%EB%B9%8C,33.4932261,126.4941635) |
| 기룡비치하임 | 제주특별자치도 제주시 애월읍 하귀1리 265-1 | 42 | 281.2 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EA%B8%B0%EB%A3%A1%EB%B9%84%EC%B9%98%ED%95%98%EC%9E%84,33.4886395,126.4188542) |
| 제이시티팰리스 | 제주특별자치도 제주시 이도일동 1539-7 | 40 | 221.9 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%A0%9C%EC%9D%B4%EC%8B%9C%ED%8B%B0%ED%8C%B0%EB%A6%AC%EC%8A%A4,33.5091509,126.5243857) |
| 청풍아트빌 | 제주특별자치도 제주시 일도이동 378-7 | 40 | 272.5 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%B2%AD%ED%92%8D%EC%95%84%ED%8A%B8%EB%B9%8C,33.5058834,126.5405833) |
| 드림파크 | 제주특별자치도 제주시 한림읍 한림리 1314-60 | 39 | 194.5 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%93%9C%EB%A6%BC%ED%8C%8C%ED%81%AC,33.4180858,126.2637767) |
| 서귀포대정통합공공임대주택 | 제주특별자치도 서귀포시 대정읍 하모리 1085 | 37 | 1409.2 | NON_RESIDENTIAL_JIMOK | [지도](https://map.kakao.com/link/map/%EC%84%9C%EA%B7%80%ED%8F%AC%EB%8C%80%EC%A0%95%ED%86%B5%ED%95%A9%EA%B3%B5%EA%B3%B5%EC%9E%84%EB%8C%80%EC%A3%BC%ED%83%9D,33.2214913,126.2482101) |
| 영주빌 | 제주특별자치도 제주시 연동 2333-4 | 37 | 219.3 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%98%81%EC%A3%BC%EB%B9%8C,33.4933205,126.4904530) |
| 휴림힐타운아파트 | 제주특별자치도 제주시 오라이동 1390-1 | 36 | 2085.4 | NON_RESIDENTIAL_JIMOK | [지도](https://map.kakao.com/link/map/%ED%9C%B4%EB%A6%BC%ED%9E%90%ED%83%80%EC%9A%B4%EC%95%84%ED%8C%8C%ED%8A%B8,33.4883496,126.5142583) |
| 다솜 | 제주특별자치도 제주시 이도일동 1326-9 | 33 | 198.9 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%8B%A4%EC%86%9C,33.5077105,126.5274753) |
| 뜨래별3차 | 제주특별자치도 제주시 이도이동 1020-6 | 33 | 257.3 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%9C%A8%EB%9E%98%EB%B3%843%EC%B0%A8,33.4939223,126.5313308) |
| 일도월드하우스 | 제주특별자치도 제주시 일도이동 371-2 | 32 | 203.1 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%9D%BC%EB%8F%84%EC%9B%94%EB%93%9C%ED%95%98%EC%9A%B0%EC%8A%A4,33.5090319,126.5427873) |
| 크라운빌 | 제주특별자치도 제주시 연동 284-4 | 31 | 263.1 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%ED%81%AC%EB%9D%BC%EC%9A%B4%EB%B9%8C,33.4853933,126.4922050) |
| 루온토부띠끄원룸 | 제주특별자치도 제주시 노형동 922-9 | 29 | 264.6 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%A3%A8%EC%98%A8%ED%86%A0%EB%B6%80%EB%9D%A0%EB%81%84%EC%9B%90%EB%A3%B8,33.4832697,126.4821496) |
| 지산20차인화위더스빌 | 제주특별자치도 제주시 일도이동 330-13 | 29 | 293.4 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%A7%80%EC%82%B020%EC%B0%A8%EC%9D%B8%ED%99%94%EC%9C%84%EB%8D%94%EC%8A%A4%EB%B9%8C,33.5090004,126.5391300) |
| 엘루체 | 제주특별자치도 제주시 이도이동 1010-12 | 28 | 280.1 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%97%98%EB%A3%A8%EC%B2%B4,33.4968807,126.5314470) |
| 골드트리 | 제주특별자치도 제주시 건입동 1226-2 | 27 | 267.7 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EA%B3%A8%EB%93%9C%ED%8A%B8%EB%A6%AC,33.5138873,126.5305179) |
| 뷰티홈 | 제주특별자치도 제주시 연동 270-26 | 27 | 281.9 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%B7%B0%ED%8B%B0%ED%99%88,33.4922476,126.4908763) |
| 유정빌 | 제주특별자치도 서귀포시 서귀동 289-20 | 27 | 221.9 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%9C%A0%EC%A0%95%EB%B9%8C,33.2505974,126.5622212) |
| 한성베르뜨2차 | 제주특별자치도 제주시 삼도일동 536-3 | 26 | 209.1 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%ED%95%9C%EC%84%B1%EB%B2%A0%EB%A5%B4%EB%9C%A82%EC%B0%A8,33.5014934,126.5201139) |
| 동경원룸 | 제주특별자치도 제주시 연동 280-67 | 25 | 246.9 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%8F%99%EA%B2%BD%EC%9B%90%EB%A3%B8,33.4926067,126.4913957) |
| 밤부하우스 | 제주특별자치도 제주시 연동 294-6 | 24 | 288.8 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%B0%A4%EB%B6%80%ED%95%98%EC%9A%B0%EC%8A%A4,33.4853358,126.4943215) |
| 세원멤버스노형2차 | 제주특별자치도 제주시 노형동 906-3 | 24 | 261.8 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%84%B8%EC%9B%90%EB%A9%A4%EB%B2%84%EC%8A%A4%EB%85%B8%ED%98%952%EC%B0%A8,33.4882555,126.4842014) |
| 인트로빌 | 제주특별자치도 제주시 연동 280-31 | 24 | 200.7 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%9D%B8%ED%8A%B8%EB%A1%9C%EB%B9%8C,33.4926735,126.4914899) |
| 타임빌 | 제주특별자치도 제주시 이도이동 1060-15 | 24 | 200.5 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%ED%83%80%EC%9E%84%EB%B9%8C,33.4971683,126.5364871) |
| 태아빌 | 제주특별자치도 제주시 연동 251-26 | 24 | 257.7 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%ED%83%9C%EC%95%84%EB%B9%8C,33.4891028,126.4862088) |
| 일도주원라비앙 | 제주특별자치도 제주시 일도이동 355-16 | 22 | 243.3 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%9D%BC%EB%8F%84%EC%A3%BC%EC%9B%90%EB%9D%BC%EB%B9%84%EC%95%99,33.5090063,126.5399242) |
| 그린트리 | 제주특별자치도 제주시 애월읍 애월리 1596-1 | 20 | 1734.0 | NON_RESIDENTIAL_JIMOK | [지도](https://map.kakao.com/link/map/%EA%B7%B8%EB%A6%B0%ED%8A%B8%EB%A6%AC,33.4637410,126.3196554) |
| 도련한양(도련별장맨션) | 제주특별자치도 제주시 도련일동 1731-14 | 19 | 1257.5 | NON_RESIDENTIAL_JIMOK | [지도](https://map.kakao.com/link/map/%EB%8F%84%EB%A0%A8%ED%95%9C%EC%96%91%28%EB%8F%84%EB%A0%A8%EB%B3%84%EC%9E%A5%EB%A7%A8%EC%85%98%29,33.5092934,126.5901217) |
| 벽성뜨래별 | 제주특별자치도 제주시 이도이동 1026-1 | 19 | 206.9 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%B2%BD%EC%84%B1%EB%9C%A8%EB%9E%98%EB%B3%84,33.4931476,126.5346292) |
| 연동리젠시빌 | 제주특별자치도 제주시 연동 280-33 | 19 | 285.9 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%97%B0%EB%8F%99%EB%A6%AC%EC%A0%A0%EC%8B%9C%EB%B9%8C,33.4932722,126.4925326) |
| 화이트하우스 | 제주특별자치도 제주시 이도일동 1784-10 | 19 | 249.4 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%ED%99%94%EC%9D%B4%ED%8A%B8%ED%95%98%EC%9A%B0%EC%8A%A4,33.5009901,126.5262091) |
| 삼도이레빌2차 | 제주특별자치도 제주시 삼도일동 788-5 | 18 | 218.8 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%82%BC%EB%8F%84%EC%9D%B4%EB%A0%88%EB%B9%8C2%EC%B0%A8,33.5067657,126.5194113) |
| 일류해든빌 | 제주특별자치도 제주시 연동 2333-7 | 18 | 225.3 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%9D%BC%EB%A5%98%ED%95%B4%EB%93%A0%EB%B9%8C,33.4931250,126.4906636) |
| 함덕비치빌 | 제주특별자치도 제주시 조천읍 함덕리 2875-1 | 17 | 1046.4 | NON_RESIDENTIAL_JIMOK | [지도](https://map.kakao.com/link/map/%ED%95%A8%EB%8D%95%EB%B9%84%EC%B9%98%EB%B9%8C,33.5408011,126.6612002) |
| 남문빌라 | 제주특별자치도 제주시 삼도이동 199-12 | 16 | 289.3 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%82%A8%EB%AC%B8%EB%B9%8C%EB%9D%BC,33.5095785,126.5222644) |
| 샤인파크 | 제주특별자치도 제주시 건입동 1424 | 16 | 286.5 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%83%A4%EC%9D%B8%ED%8C%8C%ED%81%AC,33.5164401,126.5244699) |
| 남건휴먼스 | 제주특별자치도 제주시 이도일동 1685-6 | 15 | 277.6 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%82%A8%EA%B1%B4%ED%9C%B4%EB%A8%BC%EC%8A%A4,33.5024172,126.5270102) |
| 연동한양아트빌 | 제주특별자치도 제주시 연동 293-69 | 15 | 248.1 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%97%B0%EB%8F%99%ED%95%9C%EC%96%91%EC%95%84%ED%8A%B8%EB%B9%8C,33.4876488,126.4936254) |
| 제동네스트빌 | 제주특별자치도 제주시 연동 292-65 | 15 | 248.6 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%A0%9C%EB%8F%99%EB%84%A4%EC%8A%A4%ED%8A%B8%EB%B9%8C,33.4879409,126.4935156) |
| 이담세띠앙 | 제주특별자치도 제주시 일도이동 392-3 | 14 | 266.2 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%9D%B4%EB%8B%B4%EC%84%B8%EB%9D%A0%EC%95%99,33.5052774,126.5406186) |
| 뜨레모아2차 | 제주특별자치도 제주시 도남동 841 | 13 | 287.1 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%9C%A8%EB%A0%88%EB%AA%A8%EC%95%842%EC%B0%A8,33.4929231,126.5251299) |
| 광우그린빌 | 제주특별자치도 제주시 삼도일동 580-3 | 12 | 259.1 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EA%B4%91%EC%9A%B0%EA%B7%B8%EB%A6%B0%EB%B9%8C,33.4991788,126.5230975) |
| 동문그린빌 | 제주특별자치도 제주시 일도일동 1177 | 12 | 122.2 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%8F%99%EB%AC%B8%EA%B7%B8%EB%A6%B0%EB%B9%8C,33.5131233,126.5298472) |
| 미래빌라 | 제주특별자치도 제주시 삼도일동 795-30 | 12 | 107.0 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EB%AF%B8%EB%9E%98%EB%B9%8C%EB%9D%BC,33.5080726,126.5184186) |
| 연주 | 제주특별자치도 제주시 이도이동 1080-22 | 12 | 233.1 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%97%B0%EC%A3%BC,33.4922135,126.5365661) |
| 정다운 | 제주특별자치도 제주시 한림읍 대림리 1820-6 | 12 | 148.6 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%A0%95%EB%8B%A4%EC%9A%B4,33.4182446,126.2643187) |
| 삼진빌라트 | 제주특별자치도 제주시 연동 292-67 | 10 | 248.4 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%82%BC%EC%A7%84%EB%B9%8C%EB%9D%BC%ED%8A%B8,33.4879340,126.4937584) |
| 연동엘리트빌 | 제주특별자치도 제주시 연동 293-1 | 10 | 248.6 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%97%B0%EB%8F%99%EC%97%98%EB%A6%AC%ED%8A%B8%EB%B9%8C,33.4876534,126.4933822) |
| 이도그린빌 | 제주특별자치도 제주시 이도이동 1011-5 | 9 | 202.6 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%9D%B4%EB%8F%84%EA%B7%B8%EB%A6%B0%EB%B9%8C,33.4958924,126.5317949) |
| 영남화이트빌(가동) | 제주특별자치도 제주시 삼도일동 788-6 | 5 | 286.0 | SMALL_PARCEL | [지도](https://map.kakao.com/link/map/%EC%98%81%EB%82%A8%ED%99%94%EC%9D%B4%ED%8A%B8%EB%B9%8C%28%EA%B0%80%EB%8F%99%29,33.5071124,126.5194179) |
